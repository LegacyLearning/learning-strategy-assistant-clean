// api/seed-public.js
// Fresh seed endpoint that writes a public JSON blob.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  try {
    const nowIso = new Date().toISOString();
    const id = (req.query.id || `seed-public-${Date.now()}`).toString();

    const record = {
      id,
      organization: "Seed Org, Inc.",
      contact_name: "Alex Example",
      contact_email: "alex@example.com",
      summary: "Seeded via /api/seed-public to verify public blob writes.",
      outcomes: [{ title: "Outcome A", description: "Learners can do A", behaviors: ["Do A.1"] }],
      modules: [{ title: "Module 1", objective: "Objective 1", activities: ["Activity 1"] }],
      files: [],
      status: "new",
      created_at: nowIso,
      updated_at: nowIso
    };

    const { put } = await import('@vercel/blob');
    const pathname = `submissions/${id}.json`;

    // IMPORTANT: public access (no token required)
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false
    });

    return res.status(200).json({ ok: true, id, path: pathname });
  } catch (e) {
    return res.status(500).json({ error: 'seed_failed', detail: String(e?.message || e) });
  }
}
