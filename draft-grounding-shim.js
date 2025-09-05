/* draft-grounding-shim.js
 * Purpose: Automatically capture uploaded file URLs and attach them to POST /api/draft
 * so the backend can ground outcomes in the uploaded document(s).
 * How it works:
 *  - Hooks window.fetch
 *  - When /api/upload (POST) returns { url }, we remember it
 *  - When /api/draft (POST JSON) is called, we inject { files: [...] } into the body
 */

(function () {
  // Ensure we only install once
  if (window.__draftGroundingShimInstalled) return;
  window.__draftGroundingShimInstalled = true;

  const origFetch = window.fetch.bind(window);

  // Store uploaded file URLs here (deduped)
  if (!Array.isArray(window.__uploadedFiles)) {
    window.__uploadedFiles = [];
  }

  function rememberUrl(u) {
    if (!u) return;
    if (!window.__uploadedFiles.includes(u)) {
      window.__uploadedFiles.push(u);
    }
  }

  function isPost(init) {
    return (init?.method || "GET").toUpperCase() === "POST";
  }

  async function tryParseJson(res) {
    try {
      const clone = res.clone();
      // Some runtimes set no content-type header but still return JSON; try anyway
      return await clone.json();
    } catch {
      return null;
    }
  }

  // Replace fetch
  window.fetch = async function (url, init = {}) {
    try {
      // 1) When uploading files, remember returned public URL(s)
      if (typeof url === "string" && url.startsWith("/api/upload") && isPost(init)) {
        const res = await origFetch(url, init);
        const data = await tryParseJson(res);
        if (data && data.url) rememberUrl(String(data.url));
        // Also support batch upload responses like [{url}, {url}] just in case
        if (Array.isArray(data)) {
          data.forEach(item => item?.url && rememberUrl(String(item.url)));
        }
        return res;
      }

      // 2) When drafting, inject files into JSON body
      if (typeof url === "string" && url === "/api/draft" && isPost(init)) {
        const headers = new Headers(init.headers || {});
        const isJSON = (headers.get("Content-Type") || "").toLowerCase().includes("application/json");
        if (isJSON && init.body) {
          try {
            const obj = JSON.parse(init.body);
            // Respect existing files if caller already provided them
            const existing = Array.isArray(obj.files) ? obj.files.filter(Boolean) : [];
            const fromUploads = (window.__uploadedFiles || []).slice(0, 6);
            // Merge + dedupe
            const merged = Array.from(new Set([...existing, ...fromUploads]));
            obj.files = merged;
            init = { ...init, body: JSON.stringify(obj) };
          } catch {
            // Body wasn't JSON-parsable; ignore silently
          }
        }
      }
    } catch {
      // Never block the original call if our shim has issues
    }
    return origFetch(url, init);
  };

  // Optional: Expose a small helper to clear remembered files (e.g., after a successful submit)
  window.__clearUploadedFiles = function () {
    window.__uploadedFiles = [];
  };

  // Optional: Log once for debugging (comment out if you prefer silence)
  // console.log("[draft-grounding-shim] installed");
})();
