// app.js
(function () {
  const byId = (id) => document.getElementById(id);
  const text = (id) => (byId(id)?.value || "").trim();

  function setMsg(t, bad = false) {
    const m = byId("aiMsg");
    if (!m) return;
    m.textContent = t;
    m.className = "msg" + (bad ? " bad" : "");
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function buildPayload() {
    const orgName = text("orgName");
    const overview = text("overview");
    const moduleCount = parseInt(text("moduleCount") || "0", 10) || 0;
    const audience = text("audience");
    const lx = Array.from(document.querySelectorAll('input[name="lx"]:checked')).map(el => el.value);

    const prompt = [
      "ROLE: Instructional Design assistant.",
      "TASK: Return STRICT JSON only. No markdown. No prose.",
      'FORMAT: { "modules": [ { "name": "Module name", "outcomes": ["Outcome 1","Outcome 2","Outcome 3"] } ] }',
      "RULES:",
      "- If user_modules > 0, return exactly user_modules modules.",
      "- If user_modules = 0, choose a sensible number of modules.",
      "- Each module must have 3-6 outcomes.",
      '- Ban the words "understand" and "understanding".',
      "- Outcomes must be observable and measurable without percentages.",
      "",
      `ORGANIZATION: ${orgName || "TBD"}`,
      `AUDIENCE: ${audience || "TBD"}`,
      `OVERVIEW: ${overview || "TBD"}`,
      `LEARNING_EXPERIENCE_TYPES: ${lx.join(", ") || "TBD"}`,
      `USER_MODULES: ${moduleCount}`
    ].join("\n");

    return { prompt, fields: { orgName, audience, overview, lx, moduleCount } };
  }

  function parseJson(str) {
    try { return JSON.parse(str); } catch {
      const m = String(str).match(/\{[\s\S]*\}$/);
      if (!m) return {};
      try { return JSON.parse(m[0]); } catch { return {}; }
    }
  }

  function toSimpleView(obj) {
    const mods = Array.isArray(obj?.modules) ? obj.modules : [];
    const lis = mods.map(m => {
      const name = escapeHtml(m?.name || "Untitled");
      const outs = Array.isArray(m?.outcomes) ? m.outcomes : [];
      const inner = outs.map(o => `<li>${escapeHtml(String(o))}</li>`).join("");
      return `<li><b>${name}</b><ul>${inner}</ul></li>`;
    }).join("");
    return `<h3 style="margin:0 0 8px 0">Modules</h3><ol>${lis}</ol>`;
  }

  async function launch() {
    try {
      if (typeof window.runAIDraft !== "function") {
        throw new Error("window.runAIDraft is not a function. Ensure api/draft.js is loaded before app.js.");
      }
      setMsg("Launching AI...");
      const payload = buildPayload();
      const draftText = await window.runAIDraft(payload);
      const obj = parseJson(draftText);
      byId("results").innerHTML = toSimpleView(obj);
      byId("raw").textContent = JSON.stringify(obj, null, 2);
      setMsg("Done.");
    } catch (e) {
      console.error(e);
      setMsg("AI error: " + (e?.message || e), true);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const btn = byId("launchBtn");
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); launch(); });
  });
})();
