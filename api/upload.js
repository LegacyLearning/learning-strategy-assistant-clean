// api/upload.js
// Uploads a single file. The browser POSTs raw file bytes to this route.
// Example client call:
//   fetch('/api/upload?filename=' + encodeURIComponent(file.name), {
//     method: 'POST',
//     headers: { 'content-type': file.type || 'application/octet-stream' },
//     body: file
//   })
//
// Response JSON: { ok: true, url, pathname, size }

export const config = {
  api: {
    bodyParser: false // we want the raw stream, not JSON parsing
  }
};

function safeName(name = '') {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const filename = safeName(String(req.query.filename || 'upload.bin'));
    const contentType =
      req.headers['content-type'] || 'application/octet-stream';

    // Read the raw request body into a Buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    // Store in Vercel Blob (PUBLIC so Admin can read without tokens)
    const { put } = await import('@vercel/blob');
    const pathname = `uploads/${Date.now()}-${filename}`;
    const result = await put(pathname, buf, {
      access: 'public',
      contentType,
      addRandomSuffix: false
    });

    // result.url is a public URL
    return res.status(200).json({
      ok: true,
      url: result.url,
      pathname,
      size: buf.length
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'upload_failed' });
  }
}
