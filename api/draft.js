// api/draft.js
// Generates outcomes/modules that are: Behavioral, Specific, Measurable, Concise.
// NEW: Accepts `files: string[]` of uploaded public URLs and grounds outcomes in the document text.

import OpenAI from "openai";
import { lintOutcomes, hasBlockingIssues } from "../lib/outcomes.js";
import { extractTextFromUrl, capTexts } from "../lib/extract.js";

// ---------- helpers ----------
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const str = Buffer.concat(chunks).toString("utf8");
  try { return str ? JSON.parse(str) : {}; } catch { return {}; }
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

const PREFERRED_VERBS = [
  "demonstrate","perform","apply","analyze","diagnose","configure","compose","facilitate",
  "evaluate","prioritize","draft","produce","document","calibrate","troubleshoot",
  "negotiate","coach","operate","execute","prototype","simulate","present","map","classify"
];

const BANNED_VERBS = [
  "understand","know","learn","be aware","familiarize","appreciate","grasp","comprehend"
];

// System prompt emphasizes *grounding in documents* + outcome criteria
const systemPrompt = `
You are an expert instructional designer. Use the provided DOCUMENT EXCERPTS and FORM FIELDS to generate LEARNING OUTCOMES.

Rules you MUST follow:
1) Grounding — Base outcomes on the DOCUMENT EXCERPTS and the provided goals/constraints. Do not invent facts not present.
2) Behavioral — Each outcome starts with an observable action verb (no "understand/know").
3) Specific & targeted — One discrete behavior per outcome (no chained actions).
4) Measurable — Include a realistic condition and/or criterion (e.g., "within 5 min", "with 90% accuracy",
   "per the checklist", "without assistance", "in a role-play", "given a scenario").
5) Clear & concise — 10–18 words; plain language; no jargon.

Prefer verbs from this allowlist when sensible:
${PREFERRED_VERBS.join(", ")}

Never use these banned verbs (or close variants):
${BANNED_VERBS.join(", ")}

CRITICAL: Respond ONLY as JSON with properties "outcomes" (string[]) and "modules" (array of {title, description?}).
Each outcome MUST be a single sentence starting with the verb.
`;

// Optional self-heal rewrite for any non-compliant outcomes
async function rewriteIfNeeded({ openai, outcomes, context }) {
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

  const resp = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
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
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    if (!process.env.OPENAI_API_KEY) return sendJson(res, 500, { error: "OPENAI_API_KEY not set" });

    const {
      organization,
      summary,
      audience,
      constraints,
      goals,
      timeline,
      success_metrics,
      notes,
      numOutcomes,
      numModules,
      files = [] // <— NEW: array of public URLs from the uploader
    } = await readJsonBody(req);

    // 1) Pull text from uploaded docs (if any), cap sizes to avoid token blowups
    let docsText = "";
    try {
      const texts = await Promise.all(
        (Array.isArray(files) ? files : []).slice(0, 6).map(extractTextFromUrl)
      );
      docsText = capTexts(texts.filter(Boolean));
    } catch (e) {
      console.warn("extract docs failed", e);
    }

    // 2) Prepare OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
      project: process.env.OPENAI_PROJECT
    });

    // 3) Build a single user payload — includes *document excerpts*
    const userPrompt = {
      form_fields: {
        organization, summary, audience, constraints, goals, timeline, success_metrics, notes,
        numOutcomes, numModules
      },
      document_excerpts: docsText || "(no documents provided)"
    };

    // 4) Primary generation w/ JSON Schema guardrails
    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
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
        { role: "user", content: JSON.stringify(userPrompt) }
      ]
    });

    let draft = {};
    try { draft = JSON.parse(resp.output_text || "{}"); } catch { draft = { outcomes: [], modules: [] }; }

    // 5) Normalize, lint, (optional) heal
    const outcomes = (draft.outcomes || []).map(x =>
      typeof x === "string" ? x.trim() : (x?.text || "").trim()
    );
    const modules = Array.isArray(draft.modules) ? draft.modules : [];

    const context = { organization, summary, audience, constraints, goals, timeline, success_metrics, notes, files };
    const { outcomes: healedOutcomes, lint } = await rewriteIfNeeded({ openai, outcomes, context });

    return sendJson(res, 200, { outcomes: healedOutcomes, modules, lint });
  } catch (err) {
    console.error("draft error", err);
    return sendJson(res, 500, { error: "Failed to draft outcomes/modules" });
  }
}
