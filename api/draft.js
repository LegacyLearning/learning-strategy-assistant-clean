// api/draft.js
// Enforces outcomes that are Behavioral, Specific, Measurable, and Concise.
// Returns: { outcomes: string[], modules: {title, description?}[], lint: {text, issues[]}[] }

import OpenAI from "openai";
import { lintOutcomes, hasBlockingIssues } from "../lib/outcomes.js";

// -- Helpers -----------------------------------------------------------------
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

// Allowlisted / banned verbs used in the prompt for stricter style
const PREFERRED_VERBS = [
  "demonstrate","perform","apply","analyze","diagnose","configure","compose","facilitate",
  "evaluate","prioritize","draft","produce","document","calibrate","troubleshoot",
  "negotiate","coach","operate","execute","prototype","simulate","present","map","classify"
];

const BANNED_VERBS = [
  "understand","know","learn","be aware","familiarize","appreciate","grasp","comprehend"
];

// Tight system prompt: behavioral, single-skill, measurable, concise (10–18 words)
const systemPrompt = `
You are an expert instructional designer. Generate LEARNING OUTCOMES that strictly meet ALL criteria:

1) Behavioral — start with a clear, observable action verb (no "understand/know").
2) Specific & targeted — one discrete behavior per outcome (no chained actions).
3) Measurable — include a realistic condition and/or criterion (e.g., "within 5 min", "with 90% accuracy",
   "per the checklist", "without assistance", "in a role-play", "given a scenario").
4) Clear & concise — 10–18 words; plain language; no jargon.

Prefer action verbs from this allowlist when sensible:
${PREFERRED_VERBS.join(", ")}

Never use these banned verbs (or close variants):
${BANNED_VERBS.join(", ")}

CRITICAL: Respond ONLY as JSON with properties "outcomes" and "modules".
Each outcome MUST be a single sentence starting with the verb.
`;

// Optional self-heal: rewrite non-compliant outcomes in-place
async function rewriteIfNeeded({ openai, outcomes, context }) {
  const lint = lintOutcomes(outcomes);
  if (!hasBlockingIssues(lint)) return { outcomes, lint }; // already good enough

  const toFix = lint
    .map((r, i) => ({ ...r, idx: i }))
    .filter(r => r.issues.length);

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
    model: process.env.OPENAI_MODEL || "gpt-5",
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
    if (req.method !== "POST") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return sendJson(res, 500, { error: "OPENAI_API_KEY not set" });
    }

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
      numModules
    } = await readJsonBody(req);

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
      project: process.env.OPENAI_PROJECT
    });

    const userPrompt = {
      organization, summary, audience, constraints, goals, timeline, success_metrics, notes,
      numOutcomes, numModules
    };

    // Primary generation with JSON Schema guardrails
    const resp = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      temperature: 0.2,
      // You can optionally pass GPT-5 controls later:
      // reasoning: { effort: "minimal" | "medium" | "high" },
      // verbosity: "low" | "medium" | "high",
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
    try {
      draft = JSON.parse(resp.output_text || "{}");
    } catch {
      draft = { outcomes: [], modules: [] };
    }

    const outcomes = (draft.outcomes || []).map(x =>
      typeof x === "string" ? x.trim() : (x?.text || "").trim()
    );
    const modules = Array.isArray(draft.modules) ? draft.modules : [];

    const context = { organization, summary, audience, constraints, goals, timeline, success_metrics, notes };
    const { outcomes: healedOutcomes, lint } = await rewriteIfNeeded({
      openai,
      outcomes,
      context
    });

    return sendJson(res, 200, {
      outcomes: healedOutcomes,
      modules,
      lint
    });
  } catch (err) {
    console.error("draft error", err);
    return sendJson(res, 500, { error: "Failed to draft outcomes/modules" });
  }
}

