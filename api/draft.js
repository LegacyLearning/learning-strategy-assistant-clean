// api/draft.js
// Grounded generation + strict outcome rules + lint & auto-rewrite.
// Responds: { draft: { outcomes, modules }, lint, grounding }

export const config = { runtime: "nodejs18.x" };

import OpenAI from "openai";
import { lintOutcomes, hasBlockingIssues } from "../lib/outcomes.js";
import { extractTextFromUrl, capTexts } from "../lib/extract.js";

// ---------- utils ----------
async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const str = Buffer.concat(chunks).toString("utf8");
    return str ? JSON.parse(str) : {};
  } catch {
    return {};
  }
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}
function safeError(err) {
  return {
    name: err?.name,
    status: err?.status || err?.response?.status,
    code: err?.code,
    message: err?.message,
    upstream: err?.response?.data?.error?.message
  };
}

// ---------- prompts ----------
const PREFERRED_VERBS = [
  "demonstrate","perform","apply","analyze","diagnose","configure","compose","facilitate",
  "evaluate","prioritize","draft","produce","document","calibrate","troubleshoot",
  "negotiate","coach","operate","execute","prototype","simulate","present","map","classify"
];
const BANNED_VERBS = [
  "understand","know","learn","be aware","familiarize","appreciate","grasp","comprehend"
];

const systemPrompt = `
You are an expert instructional designer.

STRICT RULES (do not violate):
- Ground every outcome on DOCUMENT EXCERPTS and the provided goals/constraints. Do not invent facts.
- Behavioral: each outcome starts with an observable action verb (never use: ${BANNED_VERBS.join(", ")}).
- Specific & targeted: one discrete behavior per outcome (no chained actions).
- Measurable: include a realistic condition and/or criterion ("within 5 min", "with 90% accuracy", "per checklist", "without assistance", "in a role-play", "given a scenario").
- Clear & concise: 10–18 words; plain language; no jargon.

Prefer verbs from this allowlist when sensible: ${PREFERRED_VERBS.join(", ")}.

Output format: JSON ONLY with "outcomes": string[] and "modules": [{ "title": string, "description"?: string }].
Each outcome is a single sentence beginning with the verb.
`;

// ---------- generation helpers ----------
async function generateResponses(openai, model, userPayload, numOutcomes, numModules) {
  const resp = await openai.responses.create({
    model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "learning_strategy",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            outcomes: {
              type: "array",
              minItems: Math.max(1, Number(numOutcomes) || 5),
              items: { type: "string", maxLength: 180 }
            },
            modules: {
              type: "array",
              minItems: Math.max(1, Number(numModules) || 4),
              items: {
                type: "object",
                required: ["title"],
                additionalProperties: false,
                properties: {
                  title: { type: "string", maxLength: 120 },
                  description: { type: "string", maxLength: 400 }
                }
              }
            }
          },
          required: ["outcomes", "modules"]
        }
      }
    },
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  });
  let draft = {};
  try { draft = JSON.parse(resp.output_text || "{}"); } catch {}
  return draft;
}
async function generateChat(openai, model, userPayload) {
  const c = await openai.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ]
  });
  let draft = {};
  try { draft = JSON.parse(c.choices?.[0]?.message?.content || "{}"); } catch {}
  return draft;
}
async function tryGenerate(openai, model, userPayload, numOutcomes, numModules) {
  try {
    const d = await generateResponses(openai, model, userPayload, numOutcomes, numModules);
    if (Array.isArray(d?.outcomes) && d.outcomes.length) return d;
  } catch {}
  const d2 = await generateChat(openai, model, userPayload);
  if (Array.isArray(d2?.outcomes) && d2.outcomes.length) return d2;
  throw new Error("model-generation-failed");
}

async function rewriteIfNeeded(openai, model, outcomes, context) {
  const lint = lintOutcomes(outcomes);
  if (!hasBlockingIssues(lint)) return { outcomes, lint };

  const toFix = lint.map((r, i) => ({ ...r, idx: i })).filter(r => r.issues.length);
  const userPayload = {
    instructions: `Rewrite outcomes to meet ALL criteria:
- Start with an observable action verb (no banned verbs).
- One behavior only.
- Include a measurable condition/criterion.
- 10–18 words, plain language.
Return ONLY a JSON array of strings in the same order as provided.`,
    context,
    outcomesToFix: toFix.map(r => ({ index: r.idx, text: r.text }))
  };

  try {
    const resp = await openai.responses.create({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      input: [
        { role: "system", content: "You rewrite outcomes to meet strict criteria. Respond with JSON only." },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    });
    let payload = {};
    try { payload = JSON.parse(resp.output_text || "{}"); } catch {}
    const rewrites = Array.isArray(payload) ? payload : payload?.outcomes || [];
    const final = [...outcomes];
    toFix.forEach((r, j) => {
      const candidate = rewrites[j];
      if (typeof candidate === "string" && candidate.trim()) final[r.idx] = candidate.trim();
    });
    return { outcomes: final, lint: lintOutcomes(final) };
  } catch {
    const c = await openai.chat.completions.create({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: "You rewrite outcomes to meet strict criteria. Respond with JSON only." },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    });
    let rewrites = [];
    try { rewrites = JSON.parse(c.choices?.[0]?.message?.content || "[]"); } catch {}
    const final = [...outcomes];
    toFix.forEach((r, j) => {
      const candidate = rewrites[j];
      if (typeof candidate === "string" && candidate.trim()) final[r.idx] = candidate.trim();
    });
    return { outcomes: final, lint: lintOutcomes(final) };
  }
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) return sendJson(res, 500, { error: "OPENAI_API_KEY not set" });

    const {
      organization, summary, audience, constraints, goals, timeline,
      success_metrics, notes, numOutcomes, numModules, files = []
    } = await readJsonBody(req);

    // 1) Extract from uploaded docs (PDF/DOCX supported when ENABLE_PDF_PARSE=1)
    let texts = [];
    try {
      const slice = (Array.isArray(files) ? files : []).slice(0, 6);
      texts = await Promise.all(slice.map(extractTextFromUrl));
    } catch {}
    const nonEmpty = texts.filter(Boolean);
    const docsText = capTexts(nonEmpty);
    const grounding = {
      docCount: nonEmpty.length,
      usedCharCount: docsText.length
    };

    // 2) OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
      project: process.env.OPENAI_PROJECT
    });
    const preferred = (process.env.OPENAI_MODEL || "gpt-4o").trim();
    const modelsToTry = Array.from(new Set([preferred, "gpt-4o"]));

    // 3) Build user payload (includes document excerpts)
    const userPayload = {
      form_fields: {
        organization, summary, audience, constraints, goals, timeline,
        success_metrics, notes, numOutcomes, numModules
      },
      document_excerpts: docsText || "(no documents provided)"
    };

    // 4) Generate (Responses → Chat fallback)
    let draft = null, lastErr = null;
    for (const model of modelsToTry) {
      try {
        draft = await tryGenerate(openai, model, userPayload, numOutcomes, numModules);
        if (draft) { lastErr = null; break; }
      } catch (e) { lastErr = e; }
    }
    if (!draft) return sendJson(res, 502, { error: "OpenAI generation failed", detail: safeError(lastErr) });

    // 5) Normalize + enforce rules with lint & auto-rewrite
    const outcomesRaw = Array.isArray(draft?.outcomes) ? draft.outcomes : [];
    const outcomes = outcomesRaw.map(x => typeof x === "string" ? x.trim() : (x?.text || "").trim());
    const modules = Array.isArray(draft?.modules) ? draft.modules : [];

    const { outcomes: healedOutcomes, lint } = await rewriteIfNeeded(
      openai, modelsToTry[0], outcomes,
      { organization, summary, audience, constraints, goals, timeline, success_metrics, notes, files }
    );

    // 6) Respond
    return sendJson(res, 200, { draft: { outcomes: healedOutcomes, modules }, lint, grounding });
  } catch (err) {
    return sendJson(res, 500, { error: "Failed to draft outcomes/modules", detail: safeError(err) });
  }
}
