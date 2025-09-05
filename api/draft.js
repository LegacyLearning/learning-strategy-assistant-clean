// api/draft.js
// POST -> generates outcomes/modules using OpenAI and returns JSON
//
// Body shape (examples):
// {
//   "organization": "Acme Corp",
//   "summary": "Need onboarding for new CSMs...",
//   "audience": "New Customer Success Managers",
//   "constraints": "60 minutes per module, remote-first",
//   "numOutcomes": 3,
//   "numModules": 4
// }
//
// Response:
// { ok: true, draft: { outcomes: [...], modules: [...] } }

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'missing_OPENAI_API_KEY' });
    }

    const {
      organization = '',
      summary = '',
      audience = '',
      constraints = '',
      numOutcomes = 3,
      numModules = 4
    } = req.body || {};

    const sys = [
      'You are an expert instructional designer.',
      'Return STRICT JSON only (no markdown, no prose).',
      'JSON shape:',
      '{ "outcomes":[{"title":"","description":"","behaviors":[]}],',
      '  "modules":[{"title":"","objective":"","activities":[]}]}',
      'Limit to clear, concise bullets and plain language.',
      'Behaviors should be observable and measurable.',
      'Activities should be practical and tied to objectives.'
    ].join(' ');

    const user = [
      `Organization: ${organization || 'N/A'}`,
      audience ? `Audience: ${audience}` : '',
      constraints ? `Constraints: ${constraints}` : '',
      summary ? `Summary: ${summary}` : '',
      `Number of outcomes: ${Number(numOutcomes) || 3}`,
      `Number of modules: ${Number(numModules) || 4}`,
      '',
      'Please produce the JSON now.'
    ].filter(Boolean).join('\n');

    // Call OpenAI Chat Completions
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ]
        // If your account supports it, you can uncomment the next line
        // to hard-enforce JSON output:
        // , response_format: { type: 'json_object' }
      })
    });

    if (!r.ok) {
      const text = await r.text().catch(() => String(r.status));
      return res.status(500).json({ error: 'openai_error', detail: text });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || '';

    let draft;
    try {
      draft = JSON.parse(content);
    } catch {
      // Soft-recover: try to extract JSON-looking part
      const m = content.match(/\{[\s\S]*\}$/);
      if (m) {
        try { draft = JSON.parse(m[0]); } catch {}
      }
    }

    // Final guard
    if (!draft || typeof draft !== 'object') {
      return res.status(500).json({ error: 'parse_error', raw: content?.slice?.(0, 4000) });
    }

    // Normalize minimal shape
    draft.outcomes = Array.isArray(draft.outcomes) ? draft.outcomes : [];
    draft.modules  = Array.isArray(draft.modules)  ? draft.modules  : [];

    return res.status(200).json({ ok: true, draft });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'draft_failed' });
  }
}
