// api/plan.js
// POST only. If CF_WORKER_URL is set, proxy to <CF_WORKER_URL>/answer.
// Falls back to a local plan on any error OR non-2xx from the Worker.

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }

  const body = await readJson(req);
  const {
    orgName = "",
    overview = "",
    audience = "",
    requestedModuleCount,
    experienceTypes = [],
    files = [],
  } = body || {};

  const decidedCount =
    Number.isInteger(requestedModuleCount) && requestedModuleCount > 0
      ? requestedModuleCount
      : 4;

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  const TOKEN =
    (
      process.env.API_BEARER_TOKEN ||
      process.env.CF_WORKER_TOKEN ||
      process.env.WORKER_API_KEY ||
      process.env.ADMIN_TOKEN ||
      ""
    ).trim();

  // Try proxy to Worker if configured
  if (BASE) {
    try {
      const url = BASE.replace(/\/+$/, "") + "/answer";
      const payload = {
        orgName,
        overview,
        audience,
        requestedModuleCount,
        experienceTypes,
        files,
      };
      const headers = { "content-type": "application/json" };
      if (TOKEN) {
        headers.authorization = `Bearer ${TOKEN}`;
        headers["x-api-key"] = TOKEN;
      }

      const r = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      // If Worker is not OK, force local fallback
      if (!r.ok) throw new Error(`WORKER_${r.status}`);

      const text = await r.text();
      res.statusCode = 200;
      res.setHeader("content-type", r.headers.get("content-type") || "application/json");
      try {
        const json = JSON.parse(text);
        res.end(JSON.stringify(json));
      } catch {
        res.end(JSON.stringify({ ok: true, data: text }));
      }
      return;
    } catch {
      // fall through to local plan
    }
  }

  // Local dummy plan
  const modules = Array.from({ length: decidedCount }).map((_, i) => ({
    title: `Module ${i + 1}`,
    outcomes: makeOutcomes(experienceTypes),
  }));

  const out = {
    modules,
    meta: {
      decidedModuleCount: decidedCount,
      experienceTypes,
      orgName,
      audience,
      overviewPreview: overview.slice(0, 160),
      filesCount: files.length,
    },
  };

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(out));
}

function makeOutcomes(experienceTypes = []) {
  const base = [
    "Apply the skill in a realistic scenario within 5 minutes.",
    "Complete the workflow end-to-end with required fields.",
    "Identify common errors and choose the correct response.",
    "Demonstrate the process using provided job aids.",
    "Select the correct path for a given situation.",
    "Record the action in the required system form.",
  ];
  const n = Math.max(3, Math.min(6, 3 + Math.floor(Math.random() * 4)));
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(base[i % base.length]);
  if (experienceTypes.length) arr[0] = `Align activities with: ${experienceTypes.join(", ")}.`;
  return arr;
}

function readJson(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(buf || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
