// api/admin/submission.js
// Fetch a single submission by ID -> submissions/<id>.json
// Auth: If ADMIN_TOKEN is set, requires header x-admin-token: <token>.

export default async function handler(req, res) {
  // optional auth (only enforced if ADMIN_TOKEN exists)
  const requiredToken = process.env.ADMIN_TOKEN;
  if (requiredToken && req.headers['x-admin-token'] !== requiredToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const id = (req.query.id || '').trim();
  if (!id) {
    return res.status(400).json({ error: 'missing_id' });
  }

  try {
    const { getSubmissionById } = await import('../../lib/blob.js');
    const data = await getSubmissionById(id);
    return res.status(200).json(data);
  } catch (e) {
    if (String(e?.message || '').includes('not_found')) {
      return res.status(404).json({ error: 'not_found' });
    }
    console.error(e);
    return res.status(500).json({ error: 'read_failed' });
  }
}
