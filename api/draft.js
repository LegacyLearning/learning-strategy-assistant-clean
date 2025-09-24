// api/draft.js — robust proxy to Worker /draft with defensive I/O and error handling (CommonJS).

function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", extra["content-type"] || "application/json");
  for (const [k, v] of Object.entries(extra)) if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    // Handle already-parsed bodies just in case
    if (req.body && typeof req.body === "object") return resolve(req.body);
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

// --- normalization helpers ---
const A = (x) => Array.isArray(x) ? x : [];
const S = (x) => (x == null ? "" : String(x)).trim();
const normOutcome = (o) => typeof o === "string"
  ? { title: S(o), description: "", behaviors: [] }
  : { title: S(o.title ?? o.text ?? o.name),
      description: S(o.description ?? o.objective ?? o.summary),
      behaviors: A(o.behaviors ?? o.bullets ?? o.steps ?? o.actions).map(S).filter(Boolean) };
const normModule = (m) => typeof m === "string"
  ? { title: S(m), objective: "", activities: [] }
  : { title: S(m.title ?? m.name),
      objective: S(m.objective ?? m.description ?? m.summary),
      activities: A(m.activities ?? m.outline ?? m.steps ?? m.tasks).map(S).filter(Boolean) };
function normalizeToDraft(json) {
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = A(root?.outcomes ?? json?.outcomes ?? []);
  const modules  = A(root?.modules  ?? json?.modules  ?? []);
  return {
    outcomes: outcomes.map(normOutcome).filter(x => x.title || x.description || x.behaviors?.length),
    modules:  modules.map(normModule).filter(x => x.title || x.objective || x.activities?.length),
  };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

    const BASE_URL = process.env.CF_WORKER_URL;
    if (!BASE_URL) return send(res, 500, { error: "CF_WORKER_URL not set" });

    const url = BASE_URL.replace(/\/+$/, "") + "/draft";
    const payload = await readJsonBody(req);

    const headers = { "content-type": "application/json" };
    const bearer = (process.env.CF_WORKER_TOKEN || "").trim();
    const xApi   = (process.env.WORKER_API_KEY || "").trim();
    const xAdmin = (process.env.ADMIN_TOKEN || "").trim();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (xApi)   headers["x-api-key"] = xApi;
    if (xAdmin) headers["x-admin-token"] = xAdmin;

    // Timeout guard
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 60_000);

    let workerResp, text, json;
    try {
      workerResp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      text = await workerResp.text();
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
    } finally {
      clearTimeout(to);
    }

    const draft = normalizeToDraft(json);
    return send(res, workerResp.ok ? 200 : 502, { ok: workerResp.ok, draft, worker: json }, {
      "x-proxy-used-endpoint": "/draft",
    });
  } catch (e) {
    // Catch any unexpected crash so Vercel doesn’t emit FUNCTION_INVOCATION_FAILED
    return send(res, 500, { ok: false, error: "function_crash", detail: String(e) });
  }
};
