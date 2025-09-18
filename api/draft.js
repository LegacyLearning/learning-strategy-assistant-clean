// api/draft.js
// Worker-first proxy with OpenAI fallback. Always returns:
// { ok:true, draft:{ outcomes:[], modules:[] }, source:"worker"|"openai", extra:<raw> }

export const config = { runtime: "nodejs" };
import OpenAI from "openai";

async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    const chunks = []; for await (const c of req) chunks.push(c);
    const str = Buffer.concat(chunks).toString("utf8");
    return str ? JSON.parse(str) : {};
  } catch { return {}; }
}
function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", extra["content-type"] || "application/json");
  for (const [k, v] of Object.entries(extra)) if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ---------- normalize helpers ----------
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const asArr = (x) => Array.isArray(x) ? x : [];
const str = (x) => (x == null ? "" : String(x)).trim();

function normOutcome(o) {
  if (typeof o === "string") return { title: str(o), description: "", behaviors: [] };
  return {
    title: str(o.title ?? o.text ?? o.name),
    description: str(o.description ?? o.objective ?? o.summary),
    behaviors: asArr(o.behaviors ?? o.bullets ?? o.steps ?? o.actions).map(s=>str(s)).filter(Boolean),
  };
}
function normModule(m) {
  if (typeof m === "string") return { title: str(m), objective: "", activities: [] };
  return {
    title: str(m.title ?? m.name),
    objective: str(m.objective ?? m.description ?? m.summary),
    activities: asArr(m.activities ?? m.outline ?? m.steps ?? m.tasks).map(s=>str(s)).filter(Boolean),
  };
}
function pickCommon(json){
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = root?.outcomes ?? json?.outcomes ?? [];
  const modules  = root?.modules  ?? json?.modules  ?? [];
  return { outcomes: asArr(outcomes), modules: asArr(modules) };
}
function normalizeToDraft(json) {
  let { outcomes, modules } = pickCommon(json);
  const draft = {
    outcomes: asArr(outcomes).map(normOutcome).filter(x=>x.title||x.description||x.behaviors?.length),
    modules:  asArr(modules).map(normModule).filter(x=>x.title||x.objective||x.activities?.length),
  };
  return draft;
}

// ---------- worker call ----------
async function callWorker(base, payload, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers["x-api-key"] = token;
    headers["x-bearer-token"] = token;
  }
  const body = { ...payload };
  if (token) {
    body.key = body.key || token;
    body.token = body.token || token;
    body.apiKey = body.apiKey || token;
    body.bearer = body.bearer || token;
  }
  const ts = Date.now();
  const q = token
    ? `?ts=${ts}&token=${encodeURIComponent(token)}&key=${encodeURIComponent(token)}&apiKey=${encodeURIComponent(token)}&bearer=${encodeURIComponent(token)}`
    : `?ts=${ts}`;

  async function tryEp(ep) {
    const url = base.replace(/\/+$/, "") + ep + q;
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    const text = await r.text();
    const ctype = r.headers.get("content-type") || "application/json";
    return { ok: r.ok, status: r.status, text, ctype, used: ep };
  }

  let out = await tryEp("/answer");
  if (!out.ok) {
    const lower = (out.text || "").toLowerCase();
    if (out.status === 404 || lower.includes("no route matched") || lower.includes("not found")) {
      out = await tryEp("/draft");
    }
  }
  return out;
}

// ---------- openai fallback ----------
async function callOpenAI(payload) {
  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const openai = new OpenAI({
    apiKey,
    organization: process.env.OPENAI_ORG || undefined,
    project: process.env.OPENAI_PROJECT || undefined
  });

  const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const temp = Number(payload.temperature ?? process.env.DEFAULT_TEMPERATURE ?? 0.2) || 0.2;

  const files = asArr(payload.files).filter(Boolean);
  const prompt = [
    `TASK: Draft learning outcomes and modules.`,
    payload.organization && `Organization: ${str(payload.organization)}`,
    payload.audience && `Audience: ${str(payload.audience)}`,
    payload.summary && `Summary: ${str(payload.summary)}`,
    payload.constraints && `Constraints: ${str(payload.constraints)}`,
    files.length ? `Files:\n${files.map(u=>`- ${u}`).join('\n')}` : null,
    `Return strict JSON with fields: outcomes[{title,description,behaviors[]}], modules[{title,objective,activities[]}].`,
    `Counts: outcomes=${Number(payload.numOutcomes||3)}, modules=${Number(payload.numModules||3)}.`
  ].filter(Boolean).join('\n');

  // Use JSON response format
  const resp = await openai.chat.completions.create({
    model,
    temperature: temp,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are an instructional designer. Output ONLY valid JSON." },
      { role: "user", content: prompt }
    ]
  });

  const content = resp.choices?.[0]?.message?.content || "{}";
  let parsed = {};
  try { parsed = JSON.parse(content); } catch { parsed = {}; }

  const draft = normalizeToDraft(parsed);
  return { draft, extra: { openai_model: model, usage: resp.usage || null, raw: parsed } };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  const token = (
    process.env.API_BEARER_TOKEN ||
    process.env.CF_WORKER_TOKEN ||
    process.env.WORKER_API_KEY ||
    process.env.ADMIN_TOKEN || ""
  ).trim();

  // Read inputs
  const incoming = await readJsonBody(req);

  // Project + temperature + cache bust
  if (!incoming.projectId && process.env.DEFAULT_PROJECT_ID) {
    incoming.projectId = process.env.DEFAULT_PROJECT_ID.trim();
  }
  if (incoming.temperature == null) {
    incoming.temperature = Number(process.env.DEFAULT_TEMPERATURE || "0.2");
  }
  incoming.noCache = true;

  // Try Worker first
  if (BASE) {
    try {
      const out = await callWorker(BASE, incoming, token);
      if (out.ok) {
        let json = {};
        try { json = JSON.parse(out.text); } catch { json = {}; }
        const draft = normalizeToDraft(json);
        if (draft.outcomes.length || draft.modules.length) {
          return send(res, 200, { ok: true, draft, source: "worker", extra: json }, { "x-proxy-used-endpoint": out.used });
        }
        // If 200 but empty, fall through to OpenAI
      } else {
        // 4xx/5xx from Worker → fall through to OpenAI
      }
    } catch {
      // Network error → fall through
    }
  }

  // Fallback to OpenAI
  try {
    const { draft, extra } = await callOpenAI(incoming);
    return send(res, 200, { ok: true, draft, source: "openai", extra }, { "x-proxy-used-endpoint": "/openai" });
  } catch (e) {
    return send(res, 502, { error: "openai_fallback_failed", detail: String(e?.message || e) });
  }
}
