// api/admin/seed.js
// TEST ONLY: creates a dummy submission at submissions/<id>.json so you can
// exercise /api/admin/submissions, /api/admin/submission, and /api/admin/mark.
//
// Accepts GET or POST for convenience during setup.
// Auth: If ADMIN_TOKEN is set, requires header x-admin-token: <token>.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const requiredToken = process.env.ADMIN_TOKEN;
  if (requiredToken && req.headers['x-admin-token'] !== requiredToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const nowIso = new Date().toISOString();
    const id = (req.query.id || (req.body && req.body.id) || `seed-${Date.now()}`).toString();

    // Minimal, realistic structure
    const record = {
      id,
      organization: "Seed Org, Inc.",
      contact_name: "Alex Example",
      contact_email: "alex@example.com",
      summary: "This is a seeded submission to verify listing, fetching, and marking.",
      outcomes: [
        { title: "Outcome A", description: "Learners can do A", behaviors: ["Do A.1", "Do A.2"] },
        { title: "Outcome B", description: "Learners can do B", behaviors: ["Do B.1"] }
      ],
      modules: [
        { title: "Module 1", objective: "Objective 1", activities: ["Activity 1", "Activity 2"] },
        { title: "Module 2", objective: "Objective 2", activities: ["Activity 3"] }
      ],
      files: [],
      status: "new",
      created_at: nowIso,
      updated_at: nowIso,
      notes: "Seeded via /api/admin/seed"
    };

    // Write to Blob: submissions/<id>.json
    const { put } = await import('@vercel/blob');
    const pathname = `submissions/${id}.json`;
    await put(pathname, JSON.stringify(record, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false
      // No explicit token: SDK uses the project's Blob binding
    });

    return res.status(200).json({ ok: true, id, path: pathname });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'seed_failed' });
  }
}
