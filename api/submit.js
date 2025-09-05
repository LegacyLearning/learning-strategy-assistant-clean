// api/submit.js
// Saves a submission JSON to Vercel Blob at submissions/<id>.json (public)

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const payload = req.body || {};
    // Minimal validation
    const organization = (payload.organization || '').trim();
    const contact_name = (payload.contact_name || '').trim();
    const contact_email = (payload.contact_email || '').trim();
    const summary = (payload.summary || '').trim();
    const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
    const modules = Array.isArray(payload.modules) ? payload.modules : [];
    const files = Array.isArray(payload.files) ? payload.files : [];

    if (!organization) {
      return res.status(400).json({ error: 'missing_organization' });
    }

    const now = new Date().toISOString();
    const id = (payload.id || `sub-${Date.now()}`).toString();

    const record = {
      id,
      organization,
      contact_name,
      contact_email,
      summary,
      outcomes,
      modules,
      files,
      status: 'new',
      created_at: now,
      updated_at: now,
      notes: payload.notes || ''
    };

    // Write to Blob as PUBLIC so admin can read without tokens
    const { put } = await import('@vercel/blob');
    const pathname = `submissions/${id}.json`;
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    return res.status(200).json({ ok: true, id, path: pathname });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'submit_failed' });
  }
}
