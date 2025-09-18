// api/draft.js
// Centralized POST to your Cloudflare Worker.
// Expects window.CF_WORKER_URL to be set in index.html.

export async function postToWorker(path, body, { signal } = {}) {
  if (!window.CF_WORKER_URL) {
    throw new Error("CF_WORKER_URL is not set in index.html");
  }
  const res = await fetch(`${window.CF_WORKER_URL}${path}`, {
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
