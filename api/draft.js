// api/draft.js
// Proxies POSTs to your Cloudflare Worker /draft and normalizes the result.

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

// ---- normalization helpers
const asArr = x => Array.isArray(x) ? x : [];
const str = x => (x == null ? "" : String(x)).trim();
const normOutcome = o => typeof o === "string"
  ? { title: str(o), description: "", behaviors: [] }
  : { title: str(o.title ?? o.text ?? o.name),
      description: str(o.description ?? o.objective ?? o.summary),
      behaviors: asArr(o.behaviors ?? o.bullets ?? o.steps ?? o.actions).map(s=>str(s)).filter(Boolean) };
const normModule = m => typeof m === "string"
  ? { title: str(m), objective: "", activities: [] }
  : { title: str(m.title ?? m.name),
      objective: str(m.objective ?? m.description ?? m.summary),
      activities: asArr(m.activities ?? m.outline ?? m.steps ?? m.tasks).map(s=>str(s)).filter(Boolean) };
function normalizeToDraft(json) {
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = asArr(root?.outcomes ?? json?.outcomes ?? []);
  const modules  = asArr(root?.modules  ?? json?.modules  ?? []);
  return {
    outcomes: outcomes.map(normOutcome).filter(x => x.title || x.description || x.behaviors?.length),
    modules:  modules.map(normModule).filter(x => x.title || x.objective || x.activities?.length),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  const BASE_URL = process.env.CF_WORKER_URL;
  if (!BASE_URL) return send(res, 500, { error: "CF_WORKER_URL not set" });

  // Always hit /draft on the Worker
  const url = BASE_URL.replace(/\/+$/, "") + "/draft";

  const payload = await readJsonBody(req);

  // Optional auth headers from env (supported by your repo)
  const headers = { "content-type": "application/json" };
  const bearer = (process.env.CF_WORKER_TOKEN || "").trim();
  const xApi   = (process.env.WORKER_API_KEY || "").trim();
  const xAdmin = (process.env.ADMIN_TOKEN || "").trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (xApi)   headers["x-api-key"] = xApi;
  if (xAdmin) headers["x-admin-token"] = xAdmin;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal
    });

    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }

    const draft = normalizeToDraft(json);
    return send(res, r.ok ? 200 : 502, { ok: r.ok, draft, worker: json }, {
      "x-proxy-used-endpoint": "/draft"
    });
  } catch (e) {
    return send(res, 504, { ok: false, error: "worker_unreachable", detail: String(e) });
  } finally {
    clearTimeout(t);
  }
}
