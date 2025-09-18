// api/draft.js
// Proxy to your Worker that ALWAYS returns:
// { ok: true, draft: { outcomes: [...], modules: [...] }, worker: <raw worker json> }

export const config = { runtime: "nodejs" };

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
  for (const [k, v] of Object.entries(extra)) {
    if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  }
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function callWorker(url, payload, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers["x-api-key"] = token;
    headers["x-bearer-token"] = token;
    headers["x-admin-token"] = token;
    headers["x-auth-token"] = token;
    headers["x-worker-token"] = token;
  }
  const body = { ...payload };
  if (token) {
    body.key = body.key || token;
    body.token = body.token || token;
    body.apiKey = body.apiKey || token;
    body.bearer = body.bearer || token;
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "application/json";
  return { ok: r.ok, status: r.status, text, ctype };
}

function asArray(x) { return Array.isArray(x) ? x : []; }
function normOutcomes(src) {
  const arr = asArray(src);
  return arr.map(o => {
    if (typeof o === "string") return { title: o.trim(), description: "", behaviors: [] };
    const title = (o.title || o.text || "").toString().trim();
    const description = (o.description || o.objective || "").toString().trim();
    const behaviors = asArray(o.behaviors || o.bullets || o.steps).map(s => String(s).trim()).filter(Boolean);
    return { title, description, behaviors };
  }).filter(x => x.title || x.description || x.behaviors?.length);
}
function normModules(src) {
  const arr = asArray(src);
  return arr.map(m => {
    if (typeof m === "string") return { title: m.trim(), objective: "", activities: [] };
    const title = (m.title || "").toString().trim();
    const objective = (m.objective || m.description || "").toString().trim();
    const activities = asArray(m.activities || m.outline || m.steps).map(s => String(s).trim()).filter(Boolean);
    return { title, objective, activities };
  }).filter(x => x.title || x.objective || x.activities?.length);
}
function pickDraftish(json) {
  // Accept common shapes: {draft:{…}}, {outcomes,modules}, {result:{…}}, {answer:{…}}
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes =
    root?.outcomes ?? json?.outcomes ?? json?.result?.outcomes ?? json?.answer?.outcomes ?? [];
  const modules =
    root?.modules ?? json?.modules ?? json?.result?.modules ?? json?.answer?.modules ?? [];
  return { outcomes, modules };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  if (!BASE) return send(res, 500, { error: "CF_WORKER_URL not set" });

  const token = (
    process.env.API_BEARER_TOKEN ||
    process.env.CF_WORKER_TOKEN ||
    process.env.WORKER_API_KEY ||
    process.env.ADMIN_TOKEN || ""
  ).trim();

  const payload = await readJsonBody(req);
  if (!payload.projectId && process.env.DEFAULT_PROJECT_ID) {
    payload.projectId = process.env.DEFAULT_PROJECT_ID.trim();
  }

  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const q = token
      ? `?token=${encodeURIComponent(token)}&key=${encodeURIComponent(token)}&apiKey=${encodeURIComponent(token)}&bearer=${encodeURIComponent(token)}`
      : "";
    // Try /answer then /draft
    let out = await callWorker(BASE.replace(/\/+$/, "") + "/answer" + q, payload, token, ac.signal);
    if (!out.ok) {
      const lower = (out.text || "").toLowerCase();
      const noRoute = out.status === 404 || lower.includes("no route matched") || lower.includes("not found");
      if (noRoute) out = await callWorker(BASE.replace(/\/+$/, "") + "/draft" + q, payload, token, ac.signal);
    }

    // Pass through non-2xx with original body
    if (!out.ok) return send(res, out.status, out.text, { "content-type": out.ctype });

    // Normalize JSON
    let workerJson = {};
    try { workerJson = JSON.parse(out.text); } catch { /* if not JSON, fall back */ }
    const { outcomes, modules } = pickDraftish(workerJson);
    const draft = { outcomes: normOutcomes(outcomes), modules: normModules(modules) };

    return send(res, 200, { ok: true, draft, worker: workerJson });
  } catch (e) {
    return send(res, 502, { error: "worker_proxy_failed", detail: String(e?.message || e) });
  } finally {
    clearTimeout(t);
  }
}
