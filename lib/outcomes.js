// lib/outcomes.js
// Lints outcomes for: banned verbs, leading verb, measurability, single action, concise length.

const BANNED = [
  /^understand\b/i, /^know\b/i, /^learn\b/i, /^be aware\b/i,
  /^appreciate\b/i, /^grasp\b/i, /^comprehend\b/i
];

const MEASURABLE_HINTS = [
  /\b\d+%/i,
  /\b\d+\s?(min|mins|minutes|hours|days)\b/i,
  /\bwithin\s?\d+\b/i,
  /\bwithout (assistance|prompts?)\b/i,
  /\bper (the )?checklist\b/i,
  /\baccording to (the )?rubric\b/i,
  /\bscore of \d+\/\d+\b/i,
  /\bon first attempt\b/i,
  /\bwith (zero|no|<\s?\d+)\s?errors?\b/i,
  /\bmeet(s)? (the )?criteria\b/i,
  /\bin a role-?play\b/i,
  /\bgiven (a|an|the) scenario\b/i
];

const MAX_WORDS = 18;
const MIN_WORDS = 10;

export function lintOutcomes(outcomes = []) {
  return outcomes.map((o) => {
    const text = String(o || "").trim();
    const words = text.split(/\s+/).filter(Boolean);
    const startsWithVerb = /^[a-z]+/i.test(text);
    const banned = BANNED.some(rx => rx.test(text));
    const measurable = MEASURABLE_HINTS.some(rx => rx.test(text));
    const multiAction = /\b(and then|, then|; then| and |;|, and )\b/i.test(text);

    const issues = [];
    if (!text) issues.push("empty");
    if (banned) issues.push("banned-verb");
    if (words.length < MIN_WORDS || words.length > MAX_WORDS) issues.push("length");
    if (!startsWithVerb) issues.push("no-leading-verb");
    if (!measurable) issues.push("no-measure");
    if (multiAction) issues.push("multiple-actions");

    return { text, issues };
  });
}

export function hasBlockingIssues(lint) {
  return lint.some(r =>
    r.issues.includes("banned-verb") ||
    r.issues.includes("no-measure") ||
    r.issues.includes("multiple-actions")
  );
}
