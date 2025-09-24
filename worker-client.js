// worker-client.js
(function () {
  function base() {
    const u = (typeof window !== "undefined" && window.CF_WORKER_URL) || "";
    if (!u) throw new Error("CF_WORKER_URL is not set on window");
    return u.replace(/\/+$/,"");
  }
  async function postJSON(url, body, {signal}={}) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      signal
    });
    let txt = "";
    if (!res.ok) { try { txt = await res.text(); } catch {} ; throw new Error("Worker error "+res.status+(txt?": "+txt:"")); }
    try { return await res.json(); } catch { return await res.text(); }
  }
  window.runAIDraft = async function runAIDraft(payload, opts={}) {
    const raw = await postJSON(base()+"/answer", payload, opts);
    if (typeof raw === "string" && raw.trim()) return raw;
    if (raw && typeof raw === "object") {
      const s = raw?.data?.draft ?? raw?.draft ?? raw?.data;
      if (typeof s === "string" && s.trim()) return s;
    }
    throw new Error("Empty model response");
  };
})();
