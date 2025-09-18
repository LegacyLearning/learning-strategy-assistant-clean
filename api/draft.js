// api/draft.js
// Always return: { ok:true, draft:{ outcomes:[], modules:[] }, worker:<raw> }.
// Adds grounding via GROUNDING_URLS env and lowers randomness via DEFAULT_TEMPERATURE.

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
  for (const [k, v] of Object.entries(extra)) if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ---------- Normalization helpers ----------
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const asArr = (x) => Array.isArray(x) ? x : [];
const str = (x) => (x == null ? "" : String(x)).trim();

function normOutcome(o) {
  if (typeof o === "string") return { title: str(o), description: "", behaviors: [] };
  return {
    title: str(o.title ?? o.text ?? o.name),
    description: str(o.description ?? o.objective ?? o.summary),
    behaviors: asArr(o.behaviors ?? o.bullets ?? o.steps ?? o.actions).map((s) => str(s)).filter(Boolean),
  };
}
function normModule(m) {
  if (typeof m === "string") return { title: str(m), objective: "", activities: [] };
  return {
    title: str(m.title ?? m.name),
    objective: str(m.objective ?? m.description ?? m.summary),
    activities: asArr(m.activities ?? m.outline ?? m.steps ?? m.tasks).map((s) => str(s)).filter(Boolean),
  };
}
function pickCommon(json) {
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = root?.outcomes ?? json?.outcomes ?? [];
  const modules  = root?.modules  ?? json?.modules  ?? [];
  return { outcomes: asArr(outcomes), modules: asArr(modules) };
}
function collectArrays(obj, path = "", out = []) {
  if (Array.isArray(obj)) { out.push({ path, key: path.split(".").pop() || "", arr: obj }); return out; }
  if (isObj(obj)) for (const [k, v] of Object.entries(obj)) collectArrays(v, path ? `${path}.${k}` : k, out);
  return out;
}
function scoreArray(e) {
  const k = (e.key || "").toLowerCase(), a = e.arr;
  const hasTitles = a.some(x => isObj(x) && (x.title || x.objective || x.description));
  const allStrings = a.length && a.every(x => typeof x === "string");
  let s = 0;
  if (/outcome|objective|goal/.test(k)) s += 5;
  if (/module|unit|lesson|section/.test(k)) s += 5;
  if (hasTitles) s += 3;
  if (allStrings) s += 2;
  s += Math.min(a.length, 6) * 0.2;
  return s;
}
function guessDraft(json) {
  const entries = collectArrays(json).sort((a,b)=>scoreArray(b)-scoreArray(a));
  if (!entries.length) return { outcomes: [], modules: [] };
  const outcomesCand = entries.find(e=>/outcome|objective|goal/i.test(e.key)) || entries[0];
  const modulesCand  = entries.find(e=>/module|unit|lesson|section/i.test(e.key) && e!==outcomesCand) || entries.find(e=>e!==outcomesCand) || entries[0];
  return {
    outcomes: asArr(outcomesCand?.arr).map(normOutcome).filter(x=>x.title||x.description||x.behaviors?.length),
    modules:  asArr(modulesCand?.arr).map(normModule).filter(x=>x.title||x.objective||x.activities?.length),
  };
}

async function callWorker(url, payload, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) { headers.authorization = `Bearer ${token}`; headers["x-api-key"] = token; headers["x-bearer-token"] = token; }
  const body = { ...payload };
  if (token) { body.key = body.key || token; body.token = body.token || token; body.apiKey = body.apiKey || token; body.bearer = body.bearer || token; }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "application/json";
  return { ok: r.ok, status: r.status, text, ctype };
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

  // ——— grounding via env ———
  const ENV_URLS = (process.env.GROUNDING_URLS || "")
    .split(",").map(s=>s.trim()).filter(Boolean);
  if (ENV_URLS.length) {
    const existing = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
    payload.files = Array.from(new Set([...existing, ...ENV_URLS])).slice(0, 8);
  }

  // ——— projectId fallback ———
  if (!payload.projectId && process.env.DEFAULT_PROJECT_ID) {
    payload.projectId = process.env.DEFAULT_PROJECT_ID.trim();
  }

  // ——— lower randomness ———
  const DEFAULT_TEMPERATURE = Number(process.env.DEFAULT_TEMPERATURE || "0.2");
  if (payload.temperature == null || Number.isNaN(Number(payload.temperature))) {
    payload.temperature = DEFAULT_TEMPERATURE;
  }

  const ac = new AbortController(); const t = setTimeout(()=>ac.abort(), 60_000);
  try {
    const q = token ? `?token=${encodeURIComponent(token)}&key=${encodeURIComponent(token)}&apiKey=${encodeURIComponent(token)}&bearer=${encodeURIComponent(token)}` : "";
    // Try /answer first, then /draft
    let used = "/answer";
    let out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal);
    if (!out.ok) {
      const lower = (out.text || "").toLowerCase();
      const noRoute = out.status === 404 || lower.includes("no route matched") || lower.includes("not found");
      if (noRoute) { used = "/draft"; out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal); }
    }
    if (!out.ok) return send(res, out.status, out.text, { "content-type": out.ctype, "x-proxy-used-endpoint": used });

    let workerJson = {}; try { workerJson = JSON.parse(out.text); } catch {}

    // Extract outcomes/modules
    let { outcomes, modules } = pickCommon(workerJson);
    if (!outcomes.length && !modules.length) ({ outcomes, modules } = guessDraft(workerJson));

    const draft = {
      outcomes: asArr(outcomes).map(normOutcome).filter(x=>x.title||x.description||x.behaviors?.length),
      modules:  asArr(modules).map(normModule).filter(x=>x.title||x.objective||x.activities?.length),
    };

    return send(res, 200, { ok:true, draft, worker: workerJson }, { "x-proxy-used-endpoint": used });
  } catch (e) {
    return send(res, 502, { error:"worker_proxy_failed", detail:String(e?.message||e) });
  } finally { clearTimeout(t); }
}
