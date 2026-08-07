/**
 * Repeated-question detection.
 *
 * Groq exposes no embedding endpoint, and shipping a vector DB for this would be
 * overkill: application questions are short, formulaic, and repeat almost verbatim
 * across postings. A character-trigram cosine over a normalised string catches
 * "Why do you want to work at Acme?" vs "Why are you interested in working at Acme?"
 * without a network hop, and it degrades gracefully instead of hallucinating.
 */

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'you', 'your', 'yours', 'we', 'our', 'us', 'i', 'me', 'my', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'and', 'or', 'if', 'that', 'this', 'it', 'as', 'please',
  'would', 'will', 'can', 'could', 'should', 'have', 'has', 'any', 'about',
]);

/** Strip company/role specifics so the same question about two employers still matches. */
export function normalizeQuestion(q = '') {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\b(required|optional|mandatory)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s) {
  const padded = `  ${s} `;
  const out = new Map();
  for (let i = 0; i < padded.length - 2; i++) {
    const g = padded.slice(i, i + 3);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [g, v] of a) { na += v * v; if (b.has(g)) dot += v * b.get(g); }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Suffix stripping, not a real stemmer. Enough to collapse work/working and
 * expectation/expected, which is where near-identical questions actually diverge.
 * Deliberately conservative — over-stemming would merge distinct questions.
 */
function stem(w) {
  return w
    .replace(/(ations?|ation)$/, 'ate')
    .replace(/(ings?|ed|es|s)$/, '')
    .replace(/(ie)$/, 'y')
    .replace(/ate$/, '');
}

function contentWords(s) {
  return new Set(
    s.split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem)
      .filter((w) => w.length > 1),
  );
}

/**
 * Blend character-level and word-level agreement. Character trigrams tolerate
 * typos and inflection; content-word overlap stops "Why did you leave your last
 * role?" from matching "Why do you want this role?" on shared surface text alone.
 */
export function questionSimilarity(a, b) {
  const na = normalizeQuestion(a);
  const nb = normalizeQuestion(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const charScore = cosine(trigrams(na), trigrams(nb));

  const wa = contentWords(na);
  const wb = contentWords(nb);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const wordScore = wa.size && wb.size ? shared / Math.min(wa.size, wb.size) : 0;

  return charScore * 0.45 + wordScore * 0.55;
}

/** Best stored answer for a question, or null when nothing is close enough. */
export function findBestAnswer(question, stored, threshold = 0.82) {
  let best = null;
  for (const entry of stored) {
    const score = questionSimilarity(question, entry.question);
    if (!best || score > best.score) best = { entry, score };
  }
  return best && best.score >= threshold ? best : null;
}

/** Fuzzy option picking — used for selects, radios and typeahead listboxes. */
export function bestOption(target, options) {
  if (!target || !options?.length) return null;
  const t = normalizeQuestion(String(target));
  let best = null;
  for (const opt of options) {
    const label = normalizeQuestion(opt.label ?? opt.value ?? '');
    if (!label) continue;
    let score;
    if (label === t) score = 1;
    else if (label.startsWith(t) || t.startsWith(label)) score = 0.92;
    else if (label.includes(t) || t.includes(label)) score = 0.85;
    else score = cosine(trigrams(t), trigrams(label));
    if (!best || score > best.score) best = { option: opt, score };
  }
  return best && best.score >= 0.55 ? best : null;
}
