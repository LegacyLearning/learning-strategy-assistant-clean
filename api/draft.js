// api/draft.js
(function () {
  const base = () => {
    const url = (window && window.CF_WORKER_URL) || "";
    if (!url) throw new Error("CF_WORKER_URL is not set on window");
    return url.replace(/\/+$/,""); // trim trailing slash
  };

  async function postToWorker(path, body) {
    const url = base() + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const text = await res.text().catch(()=>String(res.status));
      throw new Error("Worker error " + res.status + ": " + text);
    }
    return res.text();
  }

  // High-level helper used by the UI
  async function runAIDraft(payload) {
    // Accepts { prompt, fields }
    // Your Worker should read both and return a draft string
    return postToWorker("/answer", payload);
  }

  // Expose helpers
  window.postToWorker = postToWorker;
  window.runAIDraft = runAIDraft;
})();
