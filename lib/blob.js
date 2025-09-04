// lib/blob.js
// Read submissions from Vercel Blob. Assumes they're saved as:
//   submissions/<id>.json
// This uses the project's Blob binding; no manual token required.

import { list } from '@vercel/blob';

const PREFIX = 'submissions/';

async function fetchJSON(entry) {
  const url = entry.downloadUrl || entry.url;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`blob_fetch_failed_${r.status}`);
  return r.json();
}

// List all submission JSONs, newest first (by created_at/createdAt if present)
export async function listSubmissions() {
  const { blobs } = await list({ prefix: PREFIX });
  const out = [];
  for (const b of blobs) {
    if (!b.pathname.endsWith('.json')) continue;
    out.push(await fetchJSON(b));
  }
  out.sort(
    (a, b) =>
      new Date(b.created_at || b.createdAt || 0) -
      new Date(a.created_at || a.createdAt || 0)
  );
  return out;
}

// Fetch one submission by id → submissions/<id>.json
export async function getSubmissionById(id) {
  const needle = `${PREFIX}${id}.json`;
  const { blobs } = await list({ prefix: needle });
  const hit = blobs.find((b) => b.pathname === needle);
  if (!hit) throw new Error('not_found');
  return await fetchJSON(hit);
}
