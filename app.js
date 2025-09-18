// app.js
import { postToWorker } from "./api/draft.js";

const form = document.getElementById("ida-form");
const btnGenerate = document.getElementById("btn-generate");
const btnClear = document.getElementById("btn-clear");
const statusEl = document.getElementById("status");
const renderEl = document.getElementById("render");
const rawEl = document.getElementById("raw");
const copyJsonBtn = document.getElementById("copy-json");
const copyMdBtn = document.getElementById("copy-md");

btnGenerate.addEventListener("click", onGenerate);
btnClear.addEventListener("click", () => {
  form.reset();
  setStatus("");
  renderEl.innerHTML = "";
  rawEl.textContent = "{}";
});

copyJsonBtn.addEventListener("click", () => {
  const t = rawEl.textContent || "{}";
  navigator.clipboard.writeText(t).catch(() => {});
});

copyMdBtn.addEventListener("click", () => {
  const t = rawEl.textContent || "{}";
  let obj = {};
  try { obj = JSON.parse(t); } catch (_) {}
  const md = toMarkdown(obj);
  navigator.clipboard.writeText(md).catch(() => {});
});

function setStatus(msg, type = "") {
  statusEl.className = "small " + (type || "");
  statusEl.textContent = msg;
}

function getFields() {
  const audience = document.getElementById("audience").value.trim();
  const goals = document.getElementById("goals").value.trim();
  const constraints = document.getElementById("constraints").value.trim();
  const modules = parseInt(document.getElementById("modules").value || "0", 10);
  return { audience, goals, constraints, modules: isNaN(modules) ? 0 : modules };
}

function buildPrompt(fields) {
  const fixed = [
    "ROLE: You are an Instructional Design assistant.",
    "TASK: Produce a curriculum organized into named modules.",
    "OUTPUT: Strict JSON only. No markdown. No prose outside JSON.",
    "FORMAT:",
    '{ "modules": [ { "name": "Module 1 name", "outcomes": ["Outcome 1", "Outcome 2", "Outcome 3"] } ] }',
    "RULES:",
    "- If user_modules > 0, return exactly user_modules modules.",
    "- If user_modules = 0, choose a sensible number of modules.",
    "- Each module MUST have 3 to 6 outcomes.",
    "- Outcomes MUST use Bloom action verbs.",
    "- Ban the words: understand, understanding.",
    "- Make outcomes observable and measurable without percentages.",
    "- Keep outcomes concise single sentences.",
    "- No global outcomes list.",
  ];

  const ctx = [
    `AUDIENCE: ${fields.audience || "TBD"}`,
    `BUSINESS_GOALS: ${fields.goals || "TBD"}`,
    `CONSTRAINTS: ${fields.constraints || "TBD"}`,
    `USER_MODULES: ${fields.modules}`,
  ];

  return [...fixed, ...ctx].join("\n");
}

function validateResult(obj, requestedModules) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.modules)) {
    throw new Error("Invalid JSON: missing modules[]");
  }
  const mods = obj.modules;

  if (requestedModules > 0 && mods.length !== requestedModules) {
    throw new Error(`Expected ${requestedModules} modules, got ${mods.length}`);
  }

  mods.forEach((m, i) => {
    if (!m || typeof m.name !== "string" || !m.name.trim()) {
      throw new Error(`Module ${i + 1} has no name`);
    }
    if (!Array.isArray(m.outcomes) || m.outcomes.length < 3 || m.outcomes.length > 6) {
      throw new Error(`Module ${i + 1} must have 3–6 outcomes`);
    }
    m.outcomes.forEach((o, j) => {
      if (typeof o !== "string" || !o.trim()) {
        throw new Error(`Module ${i + 1} outcome ${j + 1} is empty`);
      }
      const low = o.toLowerCase();
      if (low.includes("understand")) {
        throw new Error(`Module ${i + 1} outcome ${j + 1} uses banned word "understand"`);
      }
    });
  });

  return true;
}

function render(obj) {
  const mods = obj.modules || [];
  const container = document.createElement("div");
  container.className = "modules";

  mods.forEach((m) => {
    const box = document.createElement("div");
    box.className = "module";
    const h = document.createElement("h3");
    h.className = "mod-title";
    h.textContent = m.name;
    const list = document.createElement("ul");
    m.outcomes.forEach((o) => {
      const li = document.createElement("li");
      li.textContent = o;
      list.appendChild(li);
    });
    box.appendChild(h);
    box.appendChild(list);
    container.appendChild(box);
  });

  renderEl.innerHTML = "";
  renderEl.appendChild(container);
}

function toMarkdown(obj) {
  const mods = obj.modules || [];
  const lines = ["# Curriculum"];
  mods.forEach((m, i) => {
    lines.push(`\n## Module ${i + 1}: ${m.name}`);
    m.outcomes.forEach((o) => lines.push(`- ${o}`));
  });
  return lines.join("\n");
}

async function onGenerate() {
  const fields = getFields();
  const prompt = buildPrompt(fields);

  setStatus("Generating...");
  renderEl.innerHTML = "";
  rawEl.textContent = "{}";

  try {
    // Try primary endpoint: /answer
    // Backend should pass prompt to the model and return JSON text in { data: { draft: "..." } } OR { draft: "..." }
    const body = { prompt, fields }; // fields included for your Worker if needed
    const res = await postToWorker("/answer", body);

    const draftText =
      res?.data?.draft ?? // { ok:true, data: { draft: "..."} }
      res?.draft ??       // { draft: "..." }
      res?.data ??        // some workers return raw string in data
      "";

    if (typeof draftText !== "string" || draftText.trim() === "") {
      throw new Error("Empty model response");
    }

    // The model should output strict JSON. Parse it.
    let obj;
    try {
      obj = JSON.parse(draftText);
    } catch (e) {
      // Last resort: extract JSON block if any stray text was added
      const match = draftText.match(/\{[\s\S]*\}$/);
      if (!match) throw e;
      obj = JSON.parse(match[0]);
    }

    // Validate per your rules
    validateResult(obj, fields.modules);

    // Render
    render(obj);
    rawEl.textContent = JSON.stringify(obj, null, 2);
    setStatus("Done", "success");
  } catch (err) {
    setStatus(`Error: ${err.message}`, "err");
    rawEl.textContent = (err && err.response) ? JSON.stringify(err.response, null, 2) : "{}";
  }
}
