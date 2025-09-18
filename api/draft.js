// api/draft.js
// Minimal, deterministic proxy: sends Authorization + projectId to Worker,
// hits /answer and falls back to /draft if needed.

export const config = { runtime: "nodejs" };

async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    const chunks = [];
    for await (const c of req) chunks.push(c);
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
  }
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal
  });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "application/json";
  return { ok: r.ok, status: r.status, text, ctype };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  if (!BASE) return send(res, 500, { error: "CF_WORKER_URL not set" });

  const token =
    (process.env.API_BEARER_TOKEN ||
     process.env.CF_WORKER_TOKEN ||
     process.env.WORKER_API_KEY ||
     process.env.ADMIN_TOKEN || "").trim();

  const payload = await readJsonBody(req);
  if (!payload.projectId && process.env.DEFAULT_PROJECT_ID) {
    payload.projectId = process.env.DEFAULT_PROJECT_ID.trim();
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);

  try {
    // 1) Try /answer
    let url = BASE.replace(/\/+$/, "") + "/answer";
    let out = await callWorker(url, payload, token, ac.signal);
    if (out.ok) return send(res, out.status, out.text, { "content-type": out.ctype });

    // If route missing, try /draft
    const lower = (out.text || "").toLowerCase();
    const noRoute = out.status === 404 || lower.includes("no route matched") || lower.includes("not found");
    if (noRoute) {
      url = BASE.replace(/\/+$/, "") + "/draft";
      out = await callWorker(url, payload, token, ac.signal);
      return send(res, out.status, out.text, { "content-type": out.ctype });
    }

    // Otherwise pass Worker result through (e.g., 400 “Missing projectId” etc.)
    return send(res, out.status, out.text, { "content-type": out.ctype });
  } catch (e) {
    return send(res, 502, { error: "worker_proxy_failed", detail: String(e?.message || e) });
  } finally {
    clearTimeout(t);
  }
}
