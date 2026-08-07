import { Router } from 'express';
import { Profile, Answer, Resume, Application, User } from '../models.js';
import { requireAuth, rateLimit, ah } from '../middleware.js';
import { matchField, readProfileValue } from '../lib/matcher.js';
import { findBestAnswer, bestOption, normalizeQuestion } from '../lib/similarity.js';
import { complete } from '../ai/provider.js';
import { PLANNER_SYSTEM, buildPlannerUser, COVER_LETTER_SYSTEM } from '../ai/prompts.js';

const router = Router();
router.use(requireAuth);

const EEO_KEYS = new Set(['gender', 'ethnicity', 'hispanicLatino', 'veteranStatus', 'disabilityStatus']);
const SENSITIVE_KEYS = new Set([
  'requiresSponsorship', 'workAuthorized', 'visaStatus', 'expectedSalary',
  'currentSalary', 'criminalRecord', 'availableFrom', 'noticePeriod',
]);

/** Coerce a stored profile value into whatever this specific control accepts. */
function shapeValue(value, field) {
  if (value === undefined || value === null || value === '') return null;

  if (field.options?.length) {
    // Yes/No stored as boolean has to become the form's own wording.
    if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
    const hit = bestOption(String(value), field.options);
    return hit ? { value: hit.option.value ?? hit.option.label, label: hit.option.label, optionScore: hit.score } : null;
  }

  if (field.control === 'checkbox') return { value: Boolean(value) };

  if (field.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return { value: String(value).slice(0, 10) };
  }
  return { value: String(value) };
}

/**
 * POST /api/autofill/plan
 *
 * Three tiers, cheapest first:
 *   1. deterministic rules  → profile value        (no network, no cost)
 *   2. answer memory        → previously written answer, fuzzy-matched
 *   3. AI planner (Groq)    → only what tiers 1-2 could not resolve
 */
router.post('/plan', rateLimit({ max: 40, windowMs: 60_000 }), ah(async (req, res) => {
  const started = Date.now();
  const { fields = [], page = {}, resumeId, options = {} } = req.body || {};
  if (!Array.isArray(fields) || !fields.length) {
    return res.status(400).json({ error: 'No form fields were sent.' });
  }

  const [profile, storedAnswers, resume] = await Promise.all([
    Profile.findOne({ userId: req.user._id }).lean(),
    Answer.find({ userId: req.user._id }).select('question normalized answer chosenOptions timesUsed').lean(),
    resumeId
      ? Resume.findOne({ _id: resumeId, userId: req.user._id }).select('extractedText label filename mimeType').lean()
      : Resume.findOne({ userId: req.user._id, kind: 'resume', isDefault: true }).select('extractedText label filename mimeType').lean(),
  ]);

  if (!profile) return res.status(400).json({ error: 'Add your details in the dashboard before filling.' });

  const fillEEO = options.fillEEO ?? req.user.settings?.fillEEO ?? false;
  const fills = [];
  const unresolved = [];
  const stats = { rule: 0, memory: 0, ai: 0, skipped: 0 };

  /* ---- tiers 1 & 2 ------------------------------------------------------ */
  for (const field of fields.slice(0, 250)) {
    if (field.control === 'file') {
      // Documents are attached by the content script, not planned here.
      const m = matchField(field);
      if (m && ['resume', 'coverLetter', 'transcript', 'portfolioFile'].includes(m.key)) {
        fills.push({ uid: field.uid, kind: 'file', documentKind: m.key, confidence: m.confidence, via: 'rule' });
        stats.rule++;
      } else {
        unresolved.push(field);
      }
      continue;
    }

    const match = matchField(field);

    if (match && EEO_KEYS.has(match.key) && !fillEEO) {
      stats.skipped++;
      continue; // voluntary disclosure stays off unless the user turns it on
    }

    if (match) {
      const raw = readProfileValue(profile, match.key);
      const shaped = shapeValue(raw, field);
      if (shaped) {
        fills.push({
          uid: field.uid,
          value: shaped.value,
          label: shaped.label,
          confidence: Math.min(0.99, match.confidence * (shaped.optionScore ?? 1)),
          via: match.via,
          canonicalKey: match.key,
          needsReview: SENSITIVE_KEYS.has(match.key),
        });
        stats.rule++;
        continue;
      }
    }

    // Tier 2: has this exact question been answered before?
    const questionText = field.label || field.ariaLabel || field.placeholder || '';
    if (questionText.length > 8) {
      const hit = findBestAnswer(questionText, storedAnswers);
      if (hit) {
        const shaped = shapeValue(hit.entry.chosenOptions?.[0] || hit.entry.answer, field);
        if (shaped) {
          fills.push({
            uid: field.uid,
            value: shaped.value,
            label: shaped.label,
            confidence: hit.score,
            via: 'memory',
            repeatOf: hit.entry.question,
            needsReview: hit.score < 0.9,
          });
          stats.memory++;
          continue;
        }
      }
    }

    unresolved.push(field);
  }

  /* ---- tier 3: AI planner ---------------------------------------------- */
  let aiError = null;
  if (unresolved.length && options.useAI !== false) {
    try {
      const plan = await complete({
        provider: options.provider || req.user.settings?.aiProvider,
        system: PLANNER_SYSTEM,
        user: buildPlannerUser({
          profile: stripProfile(profile, fillEEO),
          resumeText: resume?.extractedText,
          priorAnswers: storedAnswers.sort((a, b) => b.timesUsed - a.timesUsed),
          fields: unresolved,
          page,
        }),
        json: true,
        temperature: 0.25,
        maxTokens: 4096,
      });

      const byUid = new Map(unresolved.map((f) => [f.uid, f]));
      for (const fill of plan.fills || []) {
        const field = byUid.get(fill.uid);
        if (!field || fill.value === undefined || fill.value === null || fill.value === '') continue;

        // The model is told to return exact option strings, but trust-and-verify:
        // snap anything it returns back onto a real option before we act on it.
        let value = fill.value;
        let label;
        if (field.options?.length && !Array.isArray(value)) {
          const hit = bestOption(String(value), field.options);
          if (!hit) continue;
          value = hit.option.value ?? hit.option.label;
          label = hit.option.label;
        }

        fills.push({
          uid: fill.uid,
          value,
          label,
          confidence: Math.min(0.95, Number(fill.confidence) || 0.7),
          via: 'ai',
          reasoning: fill.reasoning,
          needsReview: fill.needsReview ?? true,
          isGenerated: field.control === 'textarea',
        });
        stats.ai++;
      }
    } catch (err) {
      console.error('[planner]', err.message);
      aiError = 'AI could not reach a plan for the remaining fields. Rule-based fills still applied.';
    }
  }

  const filledUids = new Set(fills.map((f) => f.uid));
  res.json({
    fills,
    stats: { ...stats, detected: fields.length, planned: fills.length, unfilled: fields.length - filledUids.size },
    document: resume ? { id: String(resume._id), label: resume.label, filename: resume.filename } : null,
    unresolved: unresolved.filter((f) => !filledUids.has(f.uid)).map((f) => ({ uid: f.uid, label: f.label })),
    warning: aiError,
    tookMs: Date.now() - started,
  });
}));

/** Drop demographics from the AI payload entirely when EEO filling is off. */
function stripProfile(profile, fillEEO) {
  const { _id, userId, createdAt, updatedAt, __v, demographics, ...rest } = profile;
  return fillEEO ? { ...rest, demographics } : rest;
}

/** Draft a single long-form answer on demand (the "rewrite this" action in the overlay). */
router.post('/answer', rateLimit({ max: 25, windowMs: 60_000 }), ah(async (req, res) => {
  const { question, maxWords, tone, context = {} } = req.body || {};
  if (!question) return res.status(400).json({ error: 'No question was provided.' });

  const [profile, resume] = await Promise.all([
    Profile.findOne({ userId: req.user._id }).lean(),
    Resume.findOne({ userId: req.user._id, kind: 'resume', isDefault: true }).select('extractedText').lean(),
  ]);

  const answer = await complete({
    provider: req.user.settings?.aiProvider,
    system: `Answer one job-application question as this candidate, in first person.
Use only facts present in the profile and résumé — never invent employers, dates, metrics or credentials.
${maxWords ? `Hard limit: ${maxWords} words.` : 'Keep it under 150 words.'}
Tone: ${tone || 'direct and specific'}. No preamble, no restating the question, no placeholder brackets.
Output the answer text only.`,
    user: JSON.stringify({
      question,
      company: context.company,
      role: context.role,
      profile: { professional: profile?.professional, skills: profile?.skills, employment: profile?.employment?.slice(0, 4) },
      resumeExcerpt: (resume?.extractedText || '').slice(0, 5000),
    }),
    temperature: 0.6,
    maxTokens: 900,
  });

  res.json({ answer: answer.trim() });
}));

router.post('/cover-letter', rateLimit({ max: 15, windowMs: 300_000 }), ah(async (req, res) => {
  const { company, role, jobDescription } = req.body || {};
  const [profile, resume] = await Promise.all([
    Profile.findOne({ userId: req.user._id }).lean(),
    Resume.findOne({ userId: req.user._id, kind: 'resume', isDefault: true }).select('extractedText').lean(),
  ]);

  const letter = await complete({
    provider: req.user.settings?.aiProvider,
    system: COVER_LETTER_SYSTEM,
    user: JSON.stringify({
      company, role,
      jobDescription: (jobDescription || '').slice(0, 5000),
      profile: { identity: profile?.identity, professional: profile?.professional, skills: profile?.skills },
      resumeExcerpt: (resume?.extractedText || '').slice(0, 6000),
    }),
    temperature: 0.7,
    maxTokens: 1200,
  });

  res.json({ letter: letter.trim() });
}));

/** Called after a fill completes so the dashboard timeline stays accurate. */
router.post('/record', ah(async (req, res) => {
  const { page = {}, stats = {}, resumeId, durationMs } = req.body || {};
  const application = await Application.create({
    userId: req.user._id,
    company: page.company, role: page.role, url: page.url, ats: page.ats,
    fieldsDetected: stats.detected, fieldsFilled: stats.planned,
    fieldsNeedingReview: stats.needsReview, durationMs,
    resumeId: resumeId || undefined,
  });
  await User.updateOne({ _id: req.user._id }, { $inc: { 'usage.fillsThisMonth': 1 } });
  res.status(201).json({ application });
}));

export default router;
