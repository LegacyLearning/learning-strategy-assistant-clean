// api/draft.js
// Proxy to Cloudflare Worker with fallbacks, flexible auth, CF Access support,
// and DIAGNOSTICS. Now retries other endpoints on 401/403/404 and returns
// a JSON attempts report if nothing succeeds.
//
// Vercel env (Project → Settings → Environment Variables):
//   CF_WORKER_URL              = https://id-assistant.jasons-c51.workers.dev   (NO trailing path)
//   CF_WORKER_TOKEN            = <secret>   (optional)
//   WORKER_API_KEY             = <secret>   (optional)
//   ADMIN_TOKEN                = <secret>   (optional)
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

  const bodyObj = { ...payload };
  if (secret && !bodyObj.key && !bodyObj.token && !bodyObj.apiKey) bodyObj.key = secret;

  const endpoints = ["/answer", "/draft", "/strategy", "/strategy-from-fields"];
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 60_000);

  const attempts = [];
  try {
    for (const ep of endpoints) {
      const url =
        BASE.replace(/\/+$/, "") +
        ep +
        (secret ? `?key=${encodeURIComponent(secret)}&apiKey=${encodeURIComponent(secret)}&token=${encodeURIComponent(secret)}` : "");

      let r, text = "";
      try {
        r = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyObj), signal: ac.signal });
        text = await r.text();
      } catch (e) {
        attempts.push({ endpoint: ep, networkError: String(e?.message || e) });
        continue;
      }

      const ctype = r.headers.get("content-type") || "";
      const lower = (text || "").toLowerCase();
      const looksNoRoute = r.status === 404 || lower.includes("no route matched") || lower.includes("not found");

      attempts.push({
        endpoint: ep,
        status: r.status,
        contentType: ctype,
        bodyPreview: (text || "").slice(0, 400)
      });

      // If 2xx → pass through immediately
      if (r.ok) {
        const passHeaders = { "content-type": ctype || "application/json", "x-proxy-used-endpoint": ep };
        return send(res, r.status, text, passHeaders);
      }

      // If clearly wrong route or unauthorized/forbidden, try the next endpoint
      if (looksNoRoute || r.status === 401 || r.status === 403) continue;

      // Other non-2xx (e.g., 400 with details) → return what Worker said
      const passHeaders = { "content-type": ctype || "application/json", "x-proxy-used-endpoint": ep };
      return send(res, r.status, text || JSON.stringify({ error: "worker_error" }), passHeaders);
    }

    // Nothing succeeded — return consolidated diagnostics
    return send(
      res,
      502,
      {
        error: "worker_unreachable_or_no_matching_route",
        hint: "Verify Worker route and auth. See attempts for per-endpoint status and previews.",
        hadSecret: Boolean(secret),
        sentHeaders: Object.keys(headers),
        attempts
      },
      { "x-proxy-attempts": encodeURIComponent(JSON.stringify(attempts)) }
    );
  } finally {
    clearTimeout(timer);
  }
}
