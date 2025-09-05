// lib/export/docx.js
// Build a .docx file from a submission JSON.
// Requires "docx" in package.json.

import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

export async function generateDocxBuffer(data) {
  const doc = new Document({
    sections: [{ children: buildContent(data) }]
  });
  // Returns a Uint8Array; the API route will send it as application/vnd.openxmlformats...
  return await Packer.toBuffer(doc);
}

const H1 = (t) => new Paragraph({ text: t || '', heading: HeadingLevel.HEADING_1 });
const H2 = (t) => new Paragraph({ text: t || '', heading: HeadingLevel.HEADING_2 });
const P  = (t) => new Paragraph({ children: [new TextRun(String(t ?? ''))] });

function buildContent(d) {
  const out = [];

  // Title
  out.push(H1(d.organization || 'Learning Strategy Draft'));

  // Contact line
  if (d.contact_name || d.contact_email) {
    out.push(
      P(
        `Contact: ${d.contact_name || ''}${
          d.contact_email ? ' · ' + d.contact_email : ''
        }`
      )
    );
  }

  // Summary / Notes
  if (d.summary) out.push(P(d.summary));
  if (d.notes) {
    out.push(H2('Notes'));
    out.push(P(d.notes));
  }

  // Outcomes
  if (Array.isArray(d.outcomes) && d.outcomes.length) {
    out.push(H2('Outcomes'));
    d.outcomes.forEach((o, i) => {
      out.push(H2(`${i + 1}. ${o.title || 'Outcome'}`));
      if (o.description) out.push(P(o.description));
      if (Array.isArray(o.behaviors)) {
        o.behaviors.forEach((b) => out.push(P(`• ${b}`)));
      }
    });
  }

  // Modules
  if (Array.isArray(d.modules) && d.modules.length) {
    out.push(H2('Modules'));
    d.modules.forEach((m, i) => {
      out.push(H2(`${i + 1}. ${m.title || 'Module'}`));
      if (m.objective) out.push(P(`Objective: ${m.objective}`));
      if (Array.isArray(m.activities)) {
        m.activities.forEach((a) => out.push(P(`– ${a}`)));
      }
    });
  }

  return out;
}
