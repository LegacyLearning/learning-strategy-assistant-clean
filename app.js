<script>
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

  // drag & drop
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.style.background = "#f5f5f5"; });
  dropZone.addEventListener("dragleave", () => { dropZone.style.background = "transparent"; });
  dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.style.background = "transparent"; handleFiles(e.dataTransfer.files); });
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
      btn.addEventListener("click", () => { files.splice(i, 1); renderFileList(); });
      li.appendChild(btn);
      fileList.appendChild(li);
    });
  }

  launchBtn.addEventListener("click", async () => {
    launchBtn.disabled = true;
    results.innerHTML = "Generating…";

    const countValue = moduleCount.value.trim();
    const payload = {
      orgName: orgName.value || "",
      overview: overview.value || "",
      audience: audience.value || "",
      requestedModuleCount: countValue === "" ? null : parseInt(countValue, 10),
      experienceTypes: Array.from(document.querySelectorAll("input[name=lx]:checked")).map(el => el.value),
      // NOTE: placeholder names until uploader is wired to /api/upload
      files: files.map(f => f.name)
    };

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // expect { modules:[{title, outcomes:[]},...], meta:{...} } from api/plan
      // api/plan falls back to a local dummy plan if Worker is not configured. :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
      renderPlan(data);
    } catch (e) {
      results.innerHTML = `<div style="color:#b00">Error: ${escapeHtml(e.message || String(e))}</div><pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    } finally {
      launchBtn.disabled = false;
    }
  });

  function renderPlan(plan) {
    const mods = Array.isArray(plan?.modules) ? plan.modules : [];
    const meta = plan?.meta || {};
    if (!mods.length) {
      results.innerHTML = "<div>No modules returned.</div>";
      return;
    }
    const html = [
      `<div style="border:1px solid #ccc;padding:12px;border-radius:8px">`,
      `<div style="font-weight:600;margin-bottom:8px">${escapeHtml(meta.orgName || orgName.value || "Plan")}</div>`,
      `<div style="font-size:12px;color:#555;margin-bottom:8px">Modules: ${mods.length}${meta.experienceTypes ? " · Types: " + meta.experienceTypes.join(", ") : ""}</div>`,
      mods.map((m, i) => `
        <div style="margin:12px 0;padding:10px;border:1px solid #ddd;border-radius:8px">
          <div style="font-weight:600">Module ${i + 1}: ${escapeHtml(m.title || "Untitled")}</div>
          <ul style="margin:8px 0 0 18px">
            ${(Array.isArray(m.outcomes) ? m.outcomes : []).map(o => `<li>${escapeHtml(String(o))}</li>`).join("")}
          </ul>
        </div>
      `).join(""),
      `</div>`
    ].join("");
    results.innerHTML = html;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
});
</script>
