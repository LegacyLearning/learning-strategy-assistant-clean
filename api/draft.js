// api/draft.js
// Proxies POSTs to your Cloudflare Worker. Ensures /draft is always called.

export const config = { runtime: "nodejs" };

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

function send(res, status, obj, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", headers["content-type"] || "application/json");
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  }
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE_URL = process.env.CF_WORKER_URL;
  if (!BASE_URL) return send(res, 500, { error: "CF_WORKER_URL not set" });

  // Always forward to /draft on the Worker
  const url = BASE_URL.replace(/\/+$/, "") + "/draft";

  const payload = await readJsonBody(req);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal
    });

    const text = await r.text();
    const passHeaders = { "content-type": r.headers.get("content-type") || "application/json" };
    return send(res, r.status, text, passHeaders);
  } catch (e) {
    return send(res, 502, { error: "worker_proxy_failed", detail: String(e?.message || e) });
  } finally {
    clearTimeout(timer);
  }
}
