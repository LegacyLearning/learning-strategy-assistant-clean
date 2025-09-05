// lib/extract.js
// Ultra-safe text extraction. Never throws. PDF/DOCX parsing only if ENABLE_PDF_PARSE="1" and deps exist.

export async function extractTextFromUrl(url) {
  try {
    if (!url) return "";
    const res = await fetch(url);
    if (!res.ok) return "";
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);

    // Text-like?
    const looksText =
      ctype.startsWith("text/") ||
      ctype.includes("application/json") ||
      /\.(txt|md|csv|json)$/i.test(url);
    if (looksText) return safeUtf8(buf);

    // Respect feature flag for heavy parsers
    const pdfEnabled = (process.env.ENABLE_PDF_PARSE || "").trim() === "1";

    // PDF
    if (pdfEnabled && (ctype.includes("application/pdf") || /\.pdf$/i.test(url))) {
      try {
        const mod = await import("pdf-parse").catch(() => null);
        const pdfParse = mod?.default;
        if (typeof pdfParse === "function") {
          const data = await pdfParse(buf);
          return (data?.text || "").trim();
        }
      } catch {}
      return "";
    }

    // DOCX
    const isDocx =
      ctype.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
      /\.docx$/i.test(url);
    if (pdfEnabled && isDocx) {
      try {
        const JSZipMod = await import("jszip").catch(() => null);
        const ParserMod = await import("fast-xml-parser").catch(() => null);
        const JSZip = JSZipMod?.default;
        const XMLParser = ParserMod?.XMLParser;
        if (JSZip && XMLParser) {
          const zip = await JSZip.loadAsync(buf);
          const file = zip.file("word/document.xml");
          if (!file) return "";
          const xmlStr = await file.async("string");
          const parser = new XMLParser({ ignoreAttributes: false });
          const xml = parser.parse(xmlStr);

          const texts = [];
          (function walk(n) {
            if (!n || typeof n !== "object") return;
            for (const k in n) {
              const v = n[k];
              if (k === "w:t") {
                if (typeof v === "string") texts.push(v);
                else if (v && typeof v === "object" && typeof v["#text"] === "string")
                  texts.push(v["#text"]);
              } else if (Array.isArray(v)) v.forEach(walk);
              else if (typeof v === "object") walk(v);
            }
          })(xml);

          return texts.join(" ").replace(/\s+/g, " ").trim();
        }
      } catch {}
      return "";
    }

    // Unknown/binary: skip
    return "";
  } catch {
    return "";
  }
}

function safeUtf8(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
  } catch {
    return "";
  }
}

// Cap sizes to keep prompts sane
export function capTexts(texts, perDocMax = 30000, totalMax = 70000) {
  try {
    const trimmed = texts.map((t) => (t || "").slice(0, perDocMax));
    let joined = trimmed.join("\n\n---\n\n");
    if (joined.length > totalMax) joined = joined.slice(0, totalMax);
    return joined;
  } catch {
    return "";
  }
}
