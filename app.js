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

  launchBtn.addEventListener("click", async () => {
    const checked = Array.from(document.querySelectorAll("input[name=lx]:checked")).map(
      (el) => el.value
    );

    const countValue = moduleCount.value.trim();
    const payload = {
      orgName: orgName.value,
      overview: overview.value,
      audience: audience.value,
      requestedModuleCount: countValue === "" ? null : parseInt(countValue, 10),
      experienceTypes: checked,
      files: files.map((f) => f.name) // placeholder, real upload wired later
    };

    results.innerHTML = "<pre>" + JSON.stringify(payload, null, 2) + "</pre>";
  });
});
