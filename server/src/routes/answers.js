import { Router } from 'express';
import { Answer } from '../models.js';
import { requireAuth, ah } from '../middleware.js';
import { normalizeQuestion, findBestAnswer, questionSimilarity } from '../lib/similarity.js';

const router = Router();
router.use(requireAuth);

router.get('/', ah(async (req, res) => {
  const { q, limit = 200 } = req.query;
  const filter = { userId: req.user._id };
  if (q) filter.question = { $regex: String(q).slice(0, 80), $options: 'i' };

  const answers = await Answer.find(filter).sort({ pinned: -1, timesUsed: -1, updatedAt: -1 }).limit(Number(limit)).lean();
  res.json({ answers });
}));

/**
 * Upsert on the normalised question so the same question asked on ten different
 * job boards collapses into one row with a rising `timesUsed` count. That count
 * is what makes the "asked on 12 applications" signal in the dashboard real.
 */
router.post('/bulk', ah(async (req, res) => {
  const entries = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 120) : [];
  if (!entries.length) return res.status(400).json({ error: 'No answers were sent.' });

  const site = req.body.site;
  const ops = entries
    .filter((e) => e.question?.trim())
    // A blank entry is only meaningful when it is flagged as a deliberate skip.
    .filter((e) => e.skipped === true || String(e.answer ?? '').trim())
    .map((e) => {
      const skipped = e.skipped === true;
      const scope = String(e.scope || '');
      return {
        updateOne: {
          filter: { userId: req.user._id, normalized: normalizeQuestion(e.question), scope },
          update: {
            $set: {
              question: e.question.trim(),
              answer: skipped ? '' : String(e.answer).trim(),
              skipped,
              control: e.control,
              chosenOptions: skipped ? [] : (e.chosenOptions || []),
              canonicalKey: e.canonicalKey,
              lastUsedAt: new Date(),
              ...(e.source ? { source: e.source } : {}),
            },
            $setOnInsert: { userId: req.user._id, normalized: normalizeQuestion(e.question), scope },
            $inc: { timesUsed: 1 },
            ...(site ? { $addToSet: { sites: site } } : {}),
          },
          upsert: true,
        },
      };
    });

  if (!ops.length) return res.status(400).json({ error: 'No answers were sent.' });
  const result = await Answer.bulkWrite(ops, { ordered: false });
  res.json({
    saved: ops.length,
    skipped: entries.filter((e) => e.skipped === true).length,
    created: result.upsertedCount,
    updated: result.modifiedCount,
  });
}));

/** Live lookup used by the overlay when a user focuses a question mid-fill. */
router.post('/match', ah(async (req, res) => {
  const { question, threshold = 0.82 } = req.body || {};
  if (!question) return res.status(400).json({ error: 'No question was provided.' });

  const stored = await Answer.find({ userId: req.user._id, skipped: { $ne: true } }).select('question answer timesUsed chosenOptions').lean();
  const hit = findBestAnswer(question, stored, threshold);

  res.json({
    match: hit ? { ...hit.entry, score: hit.score } : null,
    alternatives: stored
      .map((e) => ({ ...e, score: questionSimilarity(question, e.question) }))
      .filter((e) => e.score >= 0.55 && (!hit || String(e._id) !== String(hit.entry._id)))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
  });
}));

router.patch('/:id', ah(async (req, res) => {
  const patch = {};
  for (const k of ['answer', 'question', 'pinned']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
  if (patch.question) patch.normalized = normalizeQuestion(patch.question);

  const answer = await Answer.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: patch }, { new: true }).lean();
  if (!answer) return res.status(404).json({ error: 'That saved answer no longer exists.' });
  res.json({ answer });
}));

router.delete('/:id', ah(async (req, res) => {
  const r = await Answer.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!r) return res.status(404).json({ error: 'That saved answer no longer exists.' });
  res.json({ deleted: true });
}));

export default router;
