// app.js
document.addEventListener("DOMContentLoaded", () => {
  const orgName = document.getElementById("orgName");
  const overview = document.getElementById("overview");
  const moduleCount = document.getElementById("moduleCount");
  const audience = document.getElementById("audience");
  const launchBtn = document.getElementById("launchBtn");
  const results = document.getElementById("results");
  const fileInput = document.getElementById("fileInput");
  const fileList = document.getElementById("fileList");
  const dropZone = document.getElementById("dropZone");

  let files = [];

  // ---------- drag & drop ----------
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.style.background = "#f5f5f5";
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.style.background = "transparent";
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.background = "transparent";
    handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  function handleFiles(list) {
    const arr = Array.from(list);
    files = [...files, ...arr];
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      li.textContent = f.name + " ";
      const btn = document.createElement("button");
      btn.textContent = "remove";
      btn.type = "button";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        files.splice(i, 1);
        renderFileList();
      });
      li.appendChild(btn);
      fileList.appendChild(li);
    });
  }

  // ---------- AI launch ----------
  launchBtn.addEventListener("click", async () => {
    // collect
    const checked = Array.from(document.querySelectorAll("input[name=lx]:checked")).map(
      (el) => el.value
    );
    const countValue = (moduleCount.value || "").trim();
    const fields = {
      orgName: (orgName.value || "").trim(),
      overview: (overview.value || "").trim(),
      audience: (audience.value || "").trim(),
      requestedModuleCount: countValue === "" ? 0 : parseInt(countValue, 10) || 0,
      experienceTypes: checked,
      files: files.map((f) => f.name) // placeholder; implement real upload later
    };

    const prompt =
`ROLE: Instructional Design assistant.
TASK: Return STRICT JSON only. No markdown. No prose.
FORMAT: { "modules": [ { "name": "Module name", "outcomes": ["Outcome 1","Outcome 2","Outcome 3"] } ] }
RULES:
- If requestedModuleCount > 0, return exactly that many modules.
- Each module has 3–6 outcomes.
- Use Bloom action verbs. Ban "understand"/"understanding".
- Outcomes must be observable and measurable without percentages.

CONTEXT:
ORG_NAME: ${fields.orgName || "TBD"}
AUDIENCE: ${fields.audience || "TBD"}
OVERVIEW: ${fields.overview || "TBD"}
USER_REQUESTED_MODULES: ${fields.requestedModuleCount}`;

    // show loading
    results.innerHTML = `<div>Launching AI…</div>`;

    try {
      // call Cloudflare Worker via api/draft.js helper
      const draftText = await window.runAIDraft({ prompt, fields });

      // parse JSON strictly; fallback to extracting last JSON block
      let obj;
      try {
        obj = JSON.parse(draftText);
      } catch {
        const m = draftText.match(/\{[\s\S]*\}$/);
        if (!m) throw new Error("Model did not return JSON");
        obj = JSON.parse(m[0]);
      }

      // render both a quick view and raw JSON
      const mods = Array.isArray(obj.modules) ? obj.modules : [];
      const quick = [
        `<h3 style="margin:0 0 8px 0">Modules</h3>`,
        `<ol>`,
        ...mods.map(m => `<li><b>${escapeHtml(m.name||"Untitled")}</b><ul>${
          Array.isArray(m.outcomes) ? m.outcomes.map(o=>`<li>${escapeHtml(String(o))}</li>`).join("") : ""
        }</ul></li>`),
        `</ol>`
      ].join("");

      results.innerHTML = `
        <div>${quick}</div>
        <h3>Raw JSON</h3>
        <pre>${escapeHtml(JSON.stringify(obj, null, 2))}</pre>
      `;
    } catch (err) {
      console.error(err);
      results.innerHTML = `<div style="color:#a00">AI error: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  });

  function escapeHtml(s){
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }
});
