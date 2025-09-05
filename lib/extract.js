// lib/extract.js
// Fetches a public URL (Vercel Blob) and extracts readable text.
// Supports: text/*, json; PDF (.pdf) via pdf-parse; DOCX (.docx) via jszip + fast-xml-parser.

export async function extractTextFromUrl(url) {
  if (!url) return "";
  const res = await fetch(url);
  if (!res.ok) return "";
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  // Plain text-ish
  const looksText =
    ctype.startsWith("text/") ||
    ctype.includes("application/json") ||
    /\.(txt|md|csv|json)$/i.test(url);
  if (looksText) {
    return safeUtf8(buf);
  }

  // PDF
  if (ctype.includes("application/pdf") || /\.pdf$/i.test(url)) {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(buf);
      return (data.text || "").trim();
    } catch {
      // fallback to raw byte->utf8 (often messy but better than nothing)
      return safeUtf8(buf);
    }
  }

  // DOCX
  const isDocx =
    ctype.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) || /\.docx$/i.test(url);
  if (isDocx) {
    try {
      const JSZip = (await import("jszip")).default;
      const { XMLParser } = await import("fast-xml-parser");
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
    } catch {
      return "";
    }
  }

  // Fallback
  return safeUtf8(buf);
}

function safeUtf8(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
  } catch {
    return "";
  }
}

// Limit each doc & total length to keep tokens sane
export function capTexts(texts, perDocMax = 30000, totalMax = 70000) {
  const trimmed = texts.map(t => (t || "").slice(0, perDocMax));
  let joined = trimmed.join("\n\n---\n\n");
  if (joined.length > totalMax) joined = joined.slice(0, totalMax);
  return joined;
}
