// api/diag-openai.js
// Minimal health check: verifies OPENAI_API_KEY presence and model availability.

export const config = { runtime: "nodejs18.x" };
import OpenAI from "openai";

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

export default async function handler(req, res) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return send(res, 500, { ok: false, error: "OPENAI_API_KEY not set" });
    }
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG,
      project: process.env.OPENAI_PROJECT
    });

    const preferred = (process.env.OPENAI_MODEL || "gpt-4o").trim();
    const modelsToTry = Array.from(new Set([preferred, "gpt-4o"]));
    const checks = [];

    for (const m of modelsToTry) {
      try {
        const info = await openai.models.retrieve(m);
        checks.push({ model: m, available: true, id: info?.id });
      } catch (e) {
        checks.push({
          model: m,
          available: false,
          status: e?.status || e?.response?.status,
          message: e?.message,
          upstream: e?.response?.data?.error?.message
        });
      }
    }

    return send(res, 200, { ok: true, checks });
  } catch (e) {
    return send(res, 500, {
      ok: false,
      error: e?.message || "unknown",
      status: e?.status || e?.response?.status,
      upstream: e?.response?.data?.error?.message
    });
  }
}
