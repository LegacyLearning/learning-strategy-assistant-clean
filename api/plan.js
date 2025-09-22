// api/plan.js — proxy to CF Worker with optional Access/Bearer, fallback on error
const WORKER_BASE_URL = process.env.WORKER_BASE_URL || process.env.CF_WORKER_URL || "";
const API_BEARER_TOKEN = process.env.API_BEARER_TOKEN || process.env.CF_WORKER_TOKEN || "";
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || "";
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || "";

function readJson(req){return new Promise((res,rej)=>{let d="";req.on("data",c=>d+=c);req.on("end",()=>{try{res(d?JSON.parse(d):{});}catch(e){res({});}});req.on("error",rej);});}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method Not Allowed" }); return; }

  const body = req.body && Object.keys(req.body).length ? req.body : await readJson(req);
  const { orgName="", overview="", audience="", requestedModuleCount, experienceTypes = [] } = body || {};
  const decidedCount = Number.isInteger(requestedModuleCount) && requestedModuleCount > 0 ? requestedModuleCount : 3;

  if (WORKER_BASE_URL) {
    try {
      const url = WORKER_BASE_URL.replace(/\/+$/,"") + "/answer";
      const headers = {
        "content-type":"application/json",
        ...(API_BEARER_TOKEN ? { authorization: `Bearer ${API_BEARER_TOKEN}` } : {}),
        ...(CF_ACCESS_CLIENT_ID ? { "cf-access-client-id": CF_ACCESS_CLIENT_ID } : {}),
        ...(CF_ACCESS_CLIENT_SECRET ? { "cf-access-client-secret": CF_ACCESS_CLIENT_SECRET } : {}),
      };
      const r = await fetch(url, {
        method:"POST",
        headers,
        body: JSON.stringify({ mode:"strategy_from_fields", orgName, overview, audience, requestedModuleCount, experienceTypes, files: body.files || [] })
      });
      if (!r.ok) throw new Error(`Worker ${r.status}`);
      const data = await r.json();
      res.setHeader("content-type","application/json");
      res.status(200).send(JSON.stringify(data));
      return;
    } catch (e) {
      console.error("Worker proxy failed:", e.message || e);
    }
  }

  // Fallback dummy
  const base = [
    "Apply the skill in a realistic scenario within 5 minutes.",
    "Complete the workflow end-to-end with required fields.",
    "Identify common errors and choose the correct response.",
    "Document the action using the standard template.",
    "Verify all checklist items are complete.",
    "Escalate edge cases according to policy."
  ];
  const modules = Array.from({ length: decidedCount }).map((_, i) => ({
    title: `Module ${i+1}`,
    outcomes: (experienceTypes.length ? [`Align activities with: ${experienceTypes.join(", ")}.`] : []).concat(base).slice(0,6)
  }));
  res.status(200).json({ modules, meta:{ decidedModuleCount: decidedCount, experienceTypes, orgName, audience, overviewPreview: overview.slice(0,120), source:"fallback" }});
};
