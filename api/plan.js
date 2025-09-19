// Vercel Serverless Function: POST /api/plan
// - If WORKER_BASE_URL is set, forwards the JSON payload to <WORKER_BASE_URL>/answer
//   and returns the Worker response.
// - Otherwise returns a local dummy plan so the UI works now.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    return res.end("Method Not Allowed");
  }

  const body = await readJson(req);
  const {
    orgName = "",
    overview = "",
    audience = "",
    requestedModuleCount,
    experienceTypes = [],
    // files may be wired later
  } = body || {};

  const decidedCount =
    Number.isInteger(requestedModuleCount) && requestedModuleCount > 0
      ? requestedModuleCount
      : 4;

  const workerBase = process.env.WORKER_BASE_URL;

  // Try proxy to Cloudflare Worker if configured
  if (workerBase) {
    try {
      const url = new URL("/answer", workerBase).toString();
      const headers = { "content-type": "application/json" };
      if (process.env.CF_ACCESS_CLIENT_ID)
        headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
      if (process.env.CF_ACCESS_CLIENT_SECRET)
        headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          orgName,
          overview,
          audience,
          requestedModuleCount,
          experienceTypes,
          files: body.files || [],
        }),
      });

      const data = await resp.json().catch(() => ({}));
      res.statusCode = resp.status || 200;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(data));
    } catch (err) {
      // Fall through to local dummy plan
    }
  }

  // Local dummy plan (keeps UI functional until Worker is wired)
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
      overviewPreview: overview.slice(0, 120),
    },
  };

  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(out));
};

function makeOutcomes(experienceTypes = []) {
  const base = [
    "Apply the critical skill in a realistic scenario within 5 minutes.",
    "Complete all required steps using all checklist items.",
    "Identify common errors and select the correct response.",
    "Demonstrate the workflow end-to-end with all required fields present.",
    "Record the action using the required system form fields.",
    "Choose the correct path for a given situation within 3 attempts.",
  ];
  const n = Math.max(3, Math.min(6, 3 + Math.floor(Math.random() * 4)));
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(base[i % base.length]);
  if (experienceTypes.length) {
    arr[0] = `Align activities with: ${experienceTypes.join(", ")}.`;
  }
  return arr;
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
