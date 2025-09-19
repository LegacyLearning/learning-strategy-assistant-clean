// api/draft.js
// Exposes a single global helper the UI can call.
// Works with a Cloudflare Worker at window.CF_WORKER_URL.
// Expected Worker responses:
//   { ok: true, data: { draft: "<STRICT JSON STRING>" } }
//   { draft: "<STRICT JSON STRING>" }
//   { ok: true, data: "<STRICT JSON STRING>" }

(function () {
  function must(url) {
    if (!url) throw new Error("CF_WORKER_URL is not set in index.html");
  }

  async function postJSON(url, body, { signal } = {}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const ctype = res.headers.get("content-type") || "";
    const isJson = ctype.includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text();

    if (!res.ok) {
      const msg =
        (isJson && data && data.error && (data.error.message || data.error.code)) ||
        (isJson && data && data.message) ||
        `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.response = data;
      throw err;
    }
    return data;
  }

  // Main entry used by your UI code.
  // `payload` can include any fields your page collects.
  // Returns a string: the model’s raw draft text.
  async function runAIDraft(payload, { signal } = {}) {
    must(window.CF_WORKER_URL);
    const res = await postJSON(`${window.CF_WORKER_URL}/answer`, payload, { signal });

    // Accept common shapes
    const draftText =
      res?.data?.draft ?? // { ok:true, data: { draft: "..." } }
      res?.draft ??       // { draft: "..." }
      res?.data ??        // { ok:true, data: "..." }
      "";

    if (typeof draftText !== "string" || !draftText.trim()) {
      throw new Error("Empty model response");
    }
    return draftText;
  }

  // Export globals so existing code can call them
  window.postToWorker = async function (path, body, opts = {}) {
    must(window.CF_WORKER_URL);
    return postJSON(`${window.CF_WORKER_URL}${path}`, body, opts);
  };
  window.runAIDraft = runAIDraft;
})();
