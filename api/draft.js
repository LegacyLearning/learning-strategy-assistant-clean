// api/draft.js
// Always return: { ok:true, draft:{ outcomes:[], modules:[] }, worker:<raw> }.
// Also keeps x-proxy-used-endpoint so we can see which Worker route responded.

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

function arr(x){ return Array.isArray(x) ? x : []; }
function normOutcomes(src){
  const a = arr(src);
  return a.map(o=>{
    if (typeof o === "string") return { title:o.trim(), description:"", behaviors:[] };
    const title = String(o.title ?? o.text ?? "").trim();
    const description = String(o.description ?? o.objective ?? "").trim();
    const behaviors = arr(o.behaviors ?? o.bullets ?? o.steps).map(s=>String(s).trim()).filter(Boolean);
    return { title, description, behaviors };
  }).filter(x=>x.title || x.description || x.behaviors?.length);
}
function normModules(src){
  const a = arr(src);
  return a.map(m=>{
    if (typeof m === "string") return { title:m.trim(), objective:"", activities:[] };
    const title = String(m.title ?? "").trim();
    const objective = String(m.objective ?? m.description ?? "").trim();
    const activities = arr(m.activities ?? m.outline ?? m.steps).map(s=>String(s).trim()).filter(Boolean);
    return { title, objective, activities };
  }).filter(x=>x.title || x.objective || x.activities?.length);
}
function pickDraftish(json){
  // Accept common shapes
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = root?.outcomes ?? json?.outcomes ?? [];
  const modules  = root?.modules  ?? json?.modules  ?? [];
  return { outcomes, modules };
}

async function callWorker(url, payload, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers["x-api-key"] = token;
  }
  const body = { ...payload };
  if (token) {
    body.key = body.key || token;
    body.token = body.token || token;
    body.apiKey = body.apiKey || token;
    body.bearer = body.bearer || token;
  }
  const r = await fetch(url, { method:"POST", headers, body:JSON.stringify(body), signal });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "application/json";
  return { ok:r.ok, status:r.status, text, ctype };
}

export default async function handler(req,res){
  if (req.method !== "POST") return send(res, 405, { error:"Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  if (!BASE) return send(res, 500, { error:"CF_WORKER_URL not set" });

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

  const ac = new AbortController(); const t=setTimeout(()=>ac.abort(), 60_000);
  try {
    const q = token ? `?token=${encodeURIComponent(token)}&key=${encodeURIComponent(token)}&apiKey=${encodeURIComponent(token)}&bearer=${encodeURIComponent(token)}` : "";
    // Try /answer then /draft
    let used = "/answer";
    let out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal);
    if (!out.ok) {
      const lower = (out.text || "").toLowerCase();
      const noRoute = out.status === 404 || lower.includes("no route matched") || lower.includes("not found");
      if (noRoute) { used = "/draft"; out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal); }
    }
    if (!out.ok) return send(res, out.status, out.text, { "content-type": out.ctype, "x-proxy-used-endpoint": used });

    // Normalize
    let workerJson={}; try{ workerJson = JSON.parse(out.text);}catch{}
    const picked = pickDraftish(workerJson);
    const draft = { outcomes: normOutcomes(picked.outcomes), modules: normModules(picked.modules) };

    return send(res, 200, { ok:true, draft, worker: workerJson }, { "x-proxy-used-endpoint": used });
  } catch(e){
    return send(res, 502, { error:"worker_proxy_failed", detail:String(e?.message||e) });
  } finally { clearTimeout(t); }
}
