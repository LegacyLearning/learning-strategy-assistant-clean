// api/diag-proxy.js
// Shows what headers/body your Vercel proxy WOULD send to the Worker (no outbound call).
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

function present(v) { return Boolean((v || "").trim()); }

export default async function handler(req, res) {
  const env = {
    CF_WORKER_URL: present(process.env.CF_WORKER_URL),
    CF_WORKER_TOKEN: present(process.env.CF_WORKER_TOKEN),
    WORKER_API_KEY: present(process.env.WORKER_API_KEY),
    ADMIN_TOKEN: present(process.env.ADMIN_TOKEN),
    CF_ACCESS_CLIENT_ID: present(process.env.CF_ACCESS_CLIENT_ID),
    CF_ACCESS_CLIENT_SECRET: present(process.env.CF_ACCESS_CLIENT_SECRET)
  };

  const secret =
    (process.env.CF_WORKER_TOKEN || process.env.WORKER_API_KEY || process.env.ADMIN_TOKEN || "").trim();

  const headers = { "content-type": "application/json", "x-proxy-diag": "1" };
  if (secret) {
    headers["authorization"] = `Bearer (redacted)`;
    headers["x-api-key"] = "(redacted)";
    headers["x-admin-token"] = "(redacted)";
    headers["x-auth-token"] = "(redacted)";
    headers["x-worker-token"] = "(redacted)";
  }
  if (present(process.env.CF_ACCESS_CLIENT_ID) && present(process.env.CF_ACCESS_CLIENT_SECRET)) {
    headers["CF-Access-Client-Id"] = "(redacted)";
    headers["CF-Access-Client-Secret"] = "(redacted)";
  }

  const body = await readJsonBody(req);
  const sample = JSON.parse(JSON.stringify(body || {}));
  if (sample.key) sample.key = "(redacted)";
  if (sample.token) sample.token = "(redacted)";
  if (sample.apiKey) sample.apiKey = "(redacted)";

  res.setHeader("Content-Type", "application/json");
  res.status(200).end(JSON.stringify({
    ok: true,
    env,
    headersToSend: headers,
    bodySample: sample,
    endpointCandidates: ["/answer", "/draft", "/strategy", "/strategy-from-fields"]
  }));
}
