(function () {
  const byId = (id) => document.getElementById(id);
  const text = (id) => (byId(id)?.value || "").trim();

  function setMsg(t, bad = false) {
    const m = byId("aiMsg");
    if (!m) return;
    m.textContent = t;
    m.className = "msg" + (bad ? " bad" : "");
  }

  function buildPayload() {
    const orgName = text("orgName");
    const overview = text("overview");
    const moduleCount = parseInt(text("moduleCount") || "0", 10) || 0;
    const audience = text("audience");

    const lx = Array.from(document.querySelectorAll('input[name="lx"]:checked'))
      .map((el) => el.value);

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

    // The Worker accepts arbitrary fields. Send both fields and a prompt.
    return { prompt, fields: { orgName, audience, overview, lx, moduleCount } };
  }

  function parseJson(str) {
    try { return JSON.parse(str); } catch { return {}; }
  }

  function toCourseOutcomes(obj) {
    // Expect: { modules: [ { name, outcomes: [] } ] }
