// api/export.js
// Exports a submission to Word (.docx)
//
// Modes:
//   1) GET  /api/export?id=<submissionId>     (admin-only if ADMIN_TOKEN is set)
//   2) POST /api/export  (body = submission JSON)

import { getSubmissionById } from '../lib/blob.js';
import { generateDocxBuffer } from '../lib/export/docx.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  try {
    let data;

    if (req.method === 'GET' && req.query.id) {
      // Optional auth enforcement if ADMIN_TOKEN exists
      const requiredToken = process.env.ADMIN_TOKEN;
      if (requiredToken && req.headers['x-admin-token'] !== requiredToken) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      data = await getSubmissionById(String(req.query.id));
    } else if (req.method === 'POST') {
      data = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'invalid_body' });
      }
    } else {
      return res.status(400).json({ error: 'unsupported' });
    }

    // Build the .docx buffer
    const buf = await generateDocxBuffer(data);

    // Nice filename based on organization
    const filename =
      (data.organization?.replace(/[^a-z0-9-_]+/gi, '_') || 'learning_strategy_draft') +
      '.docx';

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(buf));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'export_failed' });
  }
}
