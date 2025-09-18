// api/draft.js
// Robust proxy to Cloudflare Worker with endpoint fallbacks, flexible auth,
// and optional Cloudflare Access service-token headers.
//
// Set on Vercel (Project Settings → Environment Variables):
//   CF_WORKER_URL              = https://id-assistant.jasons-c51.workers.dev     (NO trailing path)
//   // Any/all of these (same value is fine):
//   CF_WORKER_TOKEN            = <shared secret>   (optional)
//   WORKER_API_KEY             = <shared secret>   (optional)
//   ADMIN_TOKEN                = <shared secret>   (optional)
//   // If your Worker is behind Cloudflare Access, also set:
//   CF_ACCESS_CLIENT_ID        = <Access Service Token ID>       (optional)
//   CF_ACCESS_CLIENT_SECRET    = <Access Service Token Secret>   (optional)

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

function send(res, status, obj, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", extra["content-type"] || "application/json");
  for (const [k, v] of Object.entries(extra)) {
    if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  }
  res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
}

function buildHeaders(secret) {
  const h = { "content-type": "application/json", "x-proxy-diag": "1" };
  if (secret) {
    h.authorization = `Bearer ${secret}`;
    h["x-api-key"] = secret;
    h["x-admin-token"] = secret;
    h["x-auth-token"] = secret;
    h["x-worker-token"] = secret;
  }
  // Optional Cloudflare Access service token headers
  const cfId = (process.env.CF_ACCESS_CLIENT_ID || "").trim();
  const cfSecret = (process.env.CF_ACCESS_CLIENT_SECRET || "").trim();
  if (cfId && cfSecret) {
    h["CF-Access-Client-Id"] = cfId;
    h["CF-Access-Client-Secret"] = cfSecret;
  }
  return h;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  if (!BASE) return send(res, 500, { error: "CF_WORKER_URL not set" });

  const secret = (process.env.CF_WORKER_TOKEN || process.env.WORKER_API_KEY || process.env.ADMIN_TOKEN || "").trim();
  const headers = buildHeaders(secret);
  const payload = await readJsonBody(req);

  // Also include a body key variant some Workers expect
  const bodyObj = { ...payload };
  if (secret && !bodyObj.key && !bodyObj.token && !bodyObj.apiKey) bodyObj.key = secret;

  const endpoints = ["/answer", "/draft", "/strategy", "/strategy-from-fields"];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);

  const attempts = [];
  try {
    for (const ep of endpoints) {
      const url = BASE.replace(/\/+$/, "") + ep + (secret ? `?key=${encodeURIComponent(secret)}` : "");
      let r, text = "";
      try {
        r = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyObj), signal: ac.signal });
        text = await r.text();
      } catch (e) {
        attempts.push({ endpoint: ep, networkError: String(e?.message || e) });
        continue;
      }

      attempts.push({ endpoint: ep, status: r.status, ctype: r.headers.get("content-type") || "" });

      const lower = (text || "").toLowerCase();
      const looksNoRoute = r.status === 404 || lower.includes("no route matched") || lower.includes("not found");
      if (looksNoRoute) continue;

      const passHeaders = { "content-type": r.headers.get("content-type") || "application/json", "x-proxy-used-endpoint": ep };
      return send(res, r.status, text, passHeaders);
    }

    return send(
      res,
      502,
      { error: "worker_unreachable_or_no_matching_route", attempts },
      { "x-proxy-attempts": encodeURIComponent(JSON.stringify(attempts)) }
    );
  } finally {
    clearTimeout(timer);
  }
}
