// api/draft.js
// Builds a canonical prompt from the page inputs, sends it in multiple fields,
// disables Worker caching, and still normalizes the response to {draft:{…}}.

export const config = { runtime: "nodejs" };

async function readJsonBody(req) {
  try {
    if (req.body && typeof req.body === "object") return req.body;
    const chunks = []; for await (const c of req) chunks.push(c);
    const str = Buffer.concat(chunks).toString("utf8");
    return str ? JSON.parse(str) : {};
  } catch { return {}; }
}
function send(res, status, body, extra = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", extra["content-type"] || "application/json");
  for (const [k, v] of Object.entries(extra)) if (k.toLowerCase() !== "content-type") res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// ---- normalize helpers
const asArr = x => Array.isArray(x) ? x : [];
const isObj = x => x && typeof x === "object" && !Array.isArray(x);
const str = x => (x == null ? "" : String(x)).trim();
const normOutcome = o => typeof o === "string"
  ? { title: str(o), description: "", behaviors: [] }
  : { title: str(o.title ?? o.text ?? o.name),
      description: str(o.description ?? o.objective ?? o.summary),
      behaviors: asArr(o.behaviors ?? o.bullets ?? o.steps ?? o.actions).map(s=>str(s)).filter(Boolean) };
const normModule = m => typeof m === "string"
  ? { title: str(m), objective: "", activities: [] }
  : { title: str(m.title ?? m.name),
      objective: str(m.objective ?? m.description ?? m.summary),
      activities: asArr(m.activities ?? m.outline ?? m.steps ?? m.tasks).map(s=>str(s)).filter(Boolean) };
function pickCommon(json){
  const root = json?.draft ?? json?.result ?? json?.answer ?? json;
  const outcomes = root?.outcomes ?? json?.outcomes ?? [];
  const modules  = root?.modules  ?? json?.modules  ?? [];
  return { outcomes: asArr(outcomes), modules: asArr(modules) };
}
function collectArrays(obj, path="", out=[]){
  if (Array.isArray(obj)) { out.push({ path, key: path.split(".").pop() || "", arr: obj }); return out; }
  if (isObj(obj)) for (const [k,v] of Object.entries(obj)) collectArrays(v, path?`${path}.${k}`:k, out);
  return out;
}
function guessDraft(json){
  const entries = collectArrays(json);
  if (!entries.length) return { outcomes: [], modules: [] };
  const score = e => {
    const k=(e.key||"").toLowerCase(), a=e.arr;
    const hasTitles = a.some(x=>isObj(x)&&(x.title||x.objective||x.description));
    const allStrings = a.length && a.every(x=>typeof x==="string");
    let s=0; if(/outcome|objective|goal/.test(k)) s+=5; if(/module|unit|lesson|section/.test(k)) s+=5;
    if(hasTitles) s+=3; if(allStrings) s+=2; s+=Math.min(a.length,6)*0.2; return s;
  };
  entries.sort((a,b)=>score(b)-score(a));
  const outCand = entries.find(e=>/outcome|objective|goal/i.test(e.key)) || entries[0];
  const modCand = entries.find(e=>/module|unit|lesson|section/i.test(e.key) && e!==outCand) || entries.find(e=>e!==outCand) || entries[0];
  return {
    outcomes: asArr(outCand?.arr).map(normOutcome).filter(x=>x.title||x.description||x.behaviors?.length),
    modules:  asArr(modCand?.arr).map(normModule).filter(x=>x.title||x.objective||x.activities?.length)
  };
}

async function callWorker(url, payload, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) { headers.authorization = `Bearer ${token}`; headers["x-api-key"] = token; headers["x-bearer-token"] = token; }
  const r = await fetch(url, { method:"POST", headers, body: JSON.stringify(payload), signal });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "application/json";
  return { ok:r.ok, status:r.status, text, ctype };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });

  const BASE = (process.env.CF_WORKER_URL || "").trim();
  if (!BASE) return send(res, 500, { error: "CF_WORKER_URL not set" });

  const token = (
    process.env.API_BEARER_TOKEN ||
    process.env.CF_WORKER_TOKEN ||
    process.env.WORKER_API_KEY ||
    process.env.ADMIN_TOKEN || ""
  ).trim();

  // Read incoming
  const incoming = await readJsonBody(req);

  // Build a canonical prompt the Worker can’t ignore
  const files = asArr(incoming.files);
  const org  = str(incoming.organization);
  const aud  = str(incoming.audience);
  const sum  = str(incoming.summary);
  const cons = str(incoming.constraints);
  const wantOut = Number.isFinite(+incoming.numOutcomes) ? +incoming.numOutcomes : 3;
  const wantMod = Number.isFinite(+incoming.numModules) ? +incoming.numModules : 3;

  const prompt = [
    `TASK: Draft learning outcomes and modules.`,
    org && `Organization: ${org}`,
    aud && `Audience: ${aud}`,
    sum && `Summary: ${sum}`,
    cons && `Constraints: ${cons}`,
    files.length ? `Files:\n${files.map(u=>`- ${u}`).join('\n')}` : null,
    `Return strict JSON with fields: outcomes[{title,description,behaviors[]}], modules[{title,objective,activities[]}].`,
    `Counts: outcomes=${wantOut}, modules=${wantMod}.`
  ].filter(Boolean).join('\n');

  // Temperature + projectId + cache-busters
  const DEFAULT_TEMPERATURE = Number(process.env.DEFAULT_TEMPERATURE || "0.2");
  const projectId = str(incoming.projectId || process.env.DEFAULT_PROJECT_ID || "");
  const ts = Date.now(); const seed = Math.floor(Math.random()*1e9);

  // Payload sent to Worker: include prompt in many names + disable caching
  const payload = {
    ...incoming,
    projectId,
    temperature: incoming.temperature ?? DEFAULT_TEMPERATURE,
    prompt, input: prompt, question: prompt, text: prompt, query: prompt, instructions: prompt,
    noCache: true, cache: "no-store", ts, seed
  };

  // Add env grounding URLs if any
  const envFiles = (process.env.GROUNDING_URLS || "").split(",").map(s=>s.trim()).filter(Boolean);
  if (envFiles.length) {
    const merged = Array.from(new Set([...(payload.files||[]), ...envFiles])).slice(0, 8);
    payload.files = merged;
  }

  // Always include tokens in body too
  if (token) {
    payload.key     = payload.key     || token;
    payload.token   = payload.token   || token;
    payload.apiKey  = payload.apiKey  || token;
    payload.bearer  = payload.bearer  || token;
  }

  const ac = new AbortController(); const t = setTimeout(()=>ac.abort(), 60_000);
  try {
    const q = `?ts=${ts}` + (token ? `&token=${encodeURIComponent(token)}&key=${encodeURIComponent(token)}&apiKey=${encodeURIComponent(token)}&bearer=${encodeURIComponent(token)}` : "");
    // Try /answer, then /draft
    let used = "/answer";
    let out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal);
    if (!out.ok) {
      const lower = (out.text || "").toLowerCase();
      const noRoute = out.status === 404 || lower.includes("no route matched") || lower.includes("not found");
      if (noRoute) { used = "/draft"; out = await callWorker(BASE.replace(/\/+$/, "") + used + q, payload, token, ac.signal); }
    }
    if (!out.ok) return send(res, out.status, out.text, { "content-type": out.ctype, "x-proxy-used-endpoint": used });

    // Normalize to {draft:{…}}
    let workerJson = {}; try { workerJson = JSON.parse(out.text); } catch {}
    let { outcomes, modules } = pickCommon(workerJson);
    if (!outcomes.length && !modules.length) ({ outcomes, modules } = guessDraft(workerJson));
    const draft = {
      outcomes: asArr(outcomes).map(normOutcome).filter(x=>x.title || x.description || x.behaviors?.length),
      modules:  asArr(modules).map(normModule).filter(x=>x.title || x.objective || x.activities?.length),
    };
    return send(res, 200, { ok:true, draft, worker: workerJson }, { "x-proxy-used-endpoint": used });
  } catch (e) {
    return send(res, 502, { error:"worker_proxy_failed", detail:String(e?.message||e) });
  } finally { clearTimeout(t); }
}
