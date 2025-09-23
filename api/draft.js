// api/draft.js
(function () {
  function base() {
    const url = (typeof window !== "undefined" && window.CF_WORKER_URL) || "";
    if (!url) throw new Error("CF_WORKER_URL is not set on window");
    return url.replace(/\/+$/,"");
  }

  async function postToWorker(path, body) {
    const url = base() + path;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
    let payloadText = "";
    if (!res.ok) {
      try { payloadText = await res.text(); } catch {}
      throw new Error("Worker error " + res.status + (payloadText ? (": " + payloadText) : ""));
    }
    // Try JSON, then text
    let data;
    try { data = await res.json(); } catch { payloadText = await res.text(); }

    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const draft = data?.data?.draft ?? data?.draft ?? data?.data;
      if (typeof draft === "string" && draft.trim()) return draft;
    }
    if (typeof payloadText === "string" && payloadText.trim()) return payloadText;

    throw new Error("Empty model response");
  }

  async function runAIDraft(payload) {
    return postToWorker("/answer", payload);
  }

  window.postToWorker = postToWorker;
  window.runAIDraft = runAIDraft;
})();
