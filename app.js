// app.js — planner form wired to /api/plan
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

  // Drag and drop
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

  fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
  });

  function handleFiles(list) {
    const arr = Array.from(list || []);
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

  launchBtn.addEventListener("click", async () => {
    const checked = Array.from(document.querySelectorAll("input[name=lx]:checked")).map(
      (el) => el.value
    );
    const countValue = (moduleCount.value || "").trim();
    const payload = {
      orgName: orgName.value || "",
      overview: overview.value || "",
      audience: audience.value || "",
      requestedModuleCount: countValue === "" ? null : Math.max(1, parseInt(countValue, 10) || 1),
      experienceTypes: checked,
      // Placeholder until upload wiring
      files: files.map((f) => ({ name: f.name })),
    };

    results.textContent = "Generating...";
    try {
      const resp = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error("API error " + resp.status);
      const data = await resp.json();
      renderPlan(data);
    } catch (err) {
      results.textContent = "Error generating plan.";
    }
  });

  function renderPlan(data) {
    if (!data || !Array.isArray(data.modules)) {
      results.textContent = "No modules returned.";
      return;
    }
    const wrap = document.createElement("div");
    data.modules.forEach((m, idx) => {
      const card = document.createElement("div");
      card.style.border = "1px solid #ddd";
      card.style.padding = "12px";
      card.style.marginBottom = "12px";
      const h = document.createElement("h3");
      h.textContent = m.title || `Module ${idx + 1}`;
      const ul = document.createElement("ul");
      (m.outcomes || []).forEach((o) => {
        const li = document.createElement("li");
        li.textContent = o;
        ul.appendChild(li);
      });
      card.appendChild(h);
      card.appendChild(ul);
      wrap.appendChild(card);
    });
    results.innerHTML = "";
    results.appendChild(wrap);
  }
});
