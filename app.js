// app.js — uploads → /api/plan → render → /api/export
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const orgName = $("orgName");
  const overview = $("overview");
  const moduleCount = $("moduleCount");
  const audience = $("audience");
  const launchBtn = $("launchBtn");
  const results = $("results");
  const fileInput = $("fileInput");
  const fileList = $("fileList");
  const dropZone = $("dropZone");

  let files = [];

  // drag & drop wiring
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.style.background = "#f5f5f5"; });
  dropZone.addEventListener("dragleave", () => { dropZone.style.background = "transparent"; });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.style.background = "transparent";
    if (e.dataTransfer?.files?.length) handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) handleFiles(Array.from(e.target.files));
  });

  function handleFiles(list) {
    files = [...files, ...list];
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
      btn.addEventListener("click", () => { files.splice(i, 1); renderFileList(); });
      li.appendChild(btn);
      fileList.appendChild(li);
    });
  }

  async function uploadOne(file) {
    const res = await fetch("/api/upload?filename=" + encodeURIComponent(file.name), {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file
    });
    if (!res.ok) throw new Error("upload_failed");
    const data = await res.json();
    if (!data?.url) throw new Error("no_url_from_upload");
    return data.url;
  }

  async function uploadAll() {
    if (!files.length) return [];
    const urls = [];
    for (const f of files) urls.push(await uploadOne(f));
    return urls;
  }

  function getExperienceTypes() {
    // index.html uses name="lx" on the checkboxes
    return Array.from(document.querySelectorAll('input[name="lx"]:checked')).map(el => el.value);
  }

  function collectForm(fileUrls) {
    const v = (moduleCount.value || "").trim();
    return {
      orgName: orgName.value.trim(),
      overview: overview.value.trim(),
      audience: audience.value.trim(),
      requestedModuleCount: v ? Number(v) : null,
      experienceTypes: getExperienceTypes(),
      files: fileUrls || []
    };
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function renderPlan(plan) {
    const mods = Array.isArray(plan?.modules) ? plan.modules : [];
    if (!mods.length) { results.innerHTML = "<div>No modules returned.</div>"; return; }
    results.innerHTML = `
      <h2>Draft plan</h2>
      ${mods.map((m, i) => `
        <section class="module" style="margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px">
          <h3>${i + 1}. ${escapeHtml(m.title || "Module")}</h3>
          ${m.objective ? `<p><strong>Objective:</strong> ${escapeHtml(m.objective)}</p>` : ""}
          ${Array.isArray(m.outcomes) ? `<ol>${m.outcomes.map(o => `<li>${escapeHtml(String(o))}</li>`).join("")}</ol>` : ""}
        </section>
      `).join("")}
      <div style="margin-top:16px">
        <button id="exportBtn">Export as Word</button>
      </div>
    `;
    $("exportBtn").onclick = () => exportDocx(plan);
  }

  async function exportDocx(plan) {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plan)
    });
    if (!res.ok) { alert("Export failed"); return; }
    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition");
    const fallback = "learning_strategy_draft.docx";
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disp || "");
    const filename = m && m[1] ? decodeURIComponent(m[1]).replace(/^"+|"+$/g, "") : fallback;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  launchBtn.addEventListener("click", async () => {
    try {
      launchBtn.disabled = true;
      launchBtn.textContent = "Uploading…";
      const urls = await uploadAll();

      const payload = collectForm(urls);

      launchBtn.textContent = "Drafting…";
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));

      const plan = await res.json(); // expect { modules:[...], meta:{...} }
      renderPlan(plan);
    } catch (e) {
      results.innerHTML = `<div style="color:#b00">Error: ${String(e?.message || e)}</div>`;
    } finally {
      launchBtn.disabled = false;
      launchBtn.textContent = "Launch AI Assistant";
    }
  });
});
