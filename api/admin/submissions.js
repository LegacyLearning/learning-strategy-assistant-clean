// api/admin/submissions.js
// Lists submissions saved in Vercel Blob under "submissions/*.json".
// Supports: ?page=1&pageSize=20&q=searchText&status=new|in_progress|done
// Auth: If ADMIN_TOKEN env var is set, requires header: x-admin-token: <token>

export default async function handler(req, res) {
  // Optional auth: only enforced if ADMIN_TOKEN is defined
  const requiredToken = process.env.ADMIN_TOKEN;
  if (requiredToken && req.headers['x-admin-token'] !== requiredToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Parse query params
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20', 10), 1), 100);
  const q = (req.query.q || '').toLowerCase();
  const status = (req.query.status || '').trim();

  // Load submissions from Blob
  const { listSubmissions } = await import('../../lib/blob.js');
  const all = await listSubmissions();

  // Filter
  const filtered = all.filter(item => {
    const hitQ = !q || JSON.stringify(item).toLowerCase().includes(q);
    const hitS = !status || item.status === status;
    return hitQ && hitS;
  });

  // Paginate
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  res.status(200).json({ total: filtered.length, items });
}
