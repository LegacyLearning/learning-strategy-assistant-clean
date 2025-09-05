// api/seed.js
// Creates a dummy submission at submissions/<id>.json (top-level route).
// No admin token required (for setup).

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  try {
    const nowIso = new Date().toISOString();
    const id = (req.query.id || `seed-${Date.now()}`).toString();

    const record = {
      id,
      organization: "Seed Org, Inc.",
      contact_name: "Alex Example",
      contact_email: "alex@example.com",
      summary: "Top-level seed to verify Blob + routes.",
      outcomes: [
        { title: "Outcome A", description: "Learners can do A", behaviors: ["Do A.1", "Do A.2"] }
      ],
      modules: [
        { title: "Module 1", objective: "Objective 1", activities: ["Activity 1"] }
      ],
      files: [],
      status: "new",
      created_at: nowIso,
      updated_at: nowIso,
      notes: "Seeded via /api/seed"
    };

    const { put } = await import('@vercel/blob');
    const pathname = `submissions/${id}.json`;
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false
      // no token param needed when Blob is connected to this project
    });

    return res.status(200).json({ ok: true, id, path: pathname });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'seed_failed', detail: String(e?.message || e) });
  }
}
