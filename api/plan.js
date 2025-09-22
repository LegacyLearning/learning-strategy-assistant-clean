// api/plan.js — Vercel Serverless Function
const WORKER_BASE_URL = process.env.WORKER_BASE_URL || "";
const CF_WORKER_TOKEN = process.env.CF_WORKER_TOKEN || "";
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || "";
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || "";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data || "{}"));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let payload = {};
  try {
    payload = req.body && Object.keys(req.body).length ? req.body : JSON.parse(await readBody(req));
  } catch (_) {
    payload = {};
  }

  if (WORKER_BASE_URL) {
    try {
      const r = await fetch(WORKER_BASE_URL.replace(/\/+$/, "") + "/answer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(CF_WORKER_TOKEN ? { authorization: `Bearer ${CF_WORKER_TOKEN}` } : {}),
          ...(CF_ACCESS_CLIENT_ID ? { "cf-access-client-id": CF_ACCESS_CLIENT_ID } : {}),
          ...(CF_ACCESS_CLIENT_SECRET ? { "cf-access-client-secret": CF_ACCESS_CLIENT_SECRET } : {}),
        },
        body: JSON.stringify({
          mode: "strategy_from_fields",
          ...payload,
        }),
      });
      if (!r.ok) throw new Error(`Worker ${r.status}`);
      const data = await r.json();
      res.setHeader("content-type", "application/json");
      res.status(200).send(JSON.stringify(data));
      return;
    } catch (e) {
      console.error("Worker proxy failed:", e.message || e);
      // fall through to local dummy
    }
  }

  // Fallback dummy plan
  const decided = payload.requestedModuleCount || 3;
  const baseOutcomes = [
    "Apply the skill in a realistic scenario within 5 minutes.",
    "Complete the workflow end-to-end with required fields.",
    "Identify common errors and choose the correct response.",
    "Document the action using the standard template.",
    "Verify all checklist items are complete.",
    "Escalate edge cases according to policy.",
  ];
  const modules = Array.from({ length: decided }).map((_, i) => ({
    title: `Module ${i + 1}`,
    outcomes: baseOutcomes.slice(0, 6).slice(0, Math.max(3, Math.min(6, 6))),
  }));
  res.status(200).json({
    modules,
    meta: {
      decidedModuleCount: decided,
      experienceTypes: payload.experienceTypes || [],
      orgName: payload.orgName || "",
      audience: payload.audience || "",
      overviewPreview: (payload.overview || "").slice(0, 120),
      source: "fallback",
    },
  });
};
