// api/admin/mark.js
// Updates a submission's status in Vercel Blob: new | in_progress | done
// Auth: If ADMIN_TOKEN is set, requires header x-admin-token: <token>.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  // Optional auth (only enforced if ADMIN_TOKEN exists)
  const requiredToken = process.env.ADMIN_TOKEN;
  if (requiredToken && req.headers['x-admin-token'] !== requiredToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const { id, status } = req.body || {};
    if (!id) return res.status(400).json({ error: 'missing_id' });

    const allowed = new Set(['new', 'in_progress', 'done']);
    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'invalid_status', allowed: Array.from(allowed) });
    }

    // Load current record
    const { getSubmissionById } = await import('../../lib/blob.js');
    let record;
    try {
      record = await getSubmissionById(String(id));
    } catch (e) {
      if (String(e?.message || '').includes('not_found')) {
        return res.status(404).json({ error: 'not_found' });
      }
      throw e;
    }

    // Update fields
    const updated = {
      ...record,
      id: record.id || String(id),
      status,
      updated_at: new Date().toISOString()
    };

    // Overwrite the blob JSON (submissions/<id>.json)
    const { put } = await import('@vercel/blob');
    const pathname = `submissions/${String(id)}.json`;
    await put(pathname, JSON.stringify(updated, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false
      // No explicit token: SDK uses the project's Blob binding
    });

    return res.status(200).json({ ok: true, id, status });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'update_failed' });
  }
}
