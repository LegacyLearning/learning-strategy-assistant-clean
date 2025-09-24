// app.js — posts to /api/draft (server route). No window.runAIDraft.

(function () {
  const $ = (id) => document.getElementById(id);

  async function callDraft(payload) {
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {})
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { raw: text }; }

    return { ok: res.ok, status: res.status, statusText: res.statusText, data };
  }

  async function launch() {
    const btn = $("aiBtn");
    const out = $("output");
    const status = $("status");

    if (btn) btn.disabled = true;
    if (status) { status.className = "muted"; status.textContent = "Requesting /api/draft..."; }

    const payload = {};
    const notesEl = $("notes");
    if (notesEl) payload.notes = notesEl.value || "";

    try {
      const r = await callDraft(payload);
      if (status) {
        status.textContent = r.ok ? "OK" : `Error ${r.status} ${r.statusText}`;
        status.className = r.ok ? "ok" : "error";
      }
      if (out) out.textContent = JSON.stringify(r.data, null, 2);
      else console.log(r);
    } catch (e) {
      if (status) { status.textContent = "Network or JS error"; status.className = "error"; }
      if (out) out.textContent = JSON.stringify({ error: String(e) }, null, 2);
      else console.error(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("aiBtn");
    if (btn) btn.addEventListener("click", launch);
  });
})();
