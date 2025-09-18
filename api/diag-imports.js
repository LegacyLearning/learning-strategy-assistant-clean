// api/diag-imports.js
// Verifies whether pdf-parse/jszip/fast-xml-parser can be imported under current build.
export const config = { runtime: "nodejs" };

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  const result = { pdf_parse: null, jszip: null, fast_xml_parser: null, enable_flag: process.env.ENABLE_PDF_PARSE || "0" };
  try {
    const m = await import("pdf-parse").catch(e => ({ __err: e?.message || String(e) }));
    result.pdf_parse = m?.default ? "ok" : (m?.__err || "not found / default missing");
  } catch (e) {
    result.pdf_parse = e?.message || String(e);
  }
  try {
    const j = await import("jszip").catch(e => ({ __err: e?.message || String(e) }));
    result.jszip = j?.default ? "ok" : (j?.__err || "not found / default missing");
  } catch (e) {
    result.jszip = e?.message || String(e);
  }
  try {
    const x = await import("fast-xml-parser").catch(e => ({ __err: e?.message || String(e) }));
    result.fast_xml_parser = x?.XMLParser ? "ok" : (x?.__err || "not found / XMLParser missing");
  } catch (e) {
    result.fast_xml_parser = e?.message || String(e);
  }
  return send(res, 200, result);
}
