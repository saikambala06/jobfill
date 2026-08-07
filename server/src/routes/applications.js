import { Router } from 'express';
import { Application, Answer, Resume } from '../models.js';
import { requireAuth, ah } from '../middleware.js';

const router = Router();
router.use(requireAuth);

router.get('/', ah(async (req, res) => {
  const { status, limit = 100 } = req.query;
  const filter = { userId: req.user._id };
  if (status) filter.status = status;

  const applications = await Application.find(filter).sort({ createdAt: -1 }).limit(Number(limit)).lean();
  res.json({ applications });
}));

/** Everything the dashboard home needs, in one round trip. */
router.get('/stats', ah(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [totals, byStatus, byAts, recent, answerCount, resumeCount] = await Promise.all([
    Application.aggregate([
      { $match: { userId: req.user._id } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        fieldsFilled: { $sum: '$fieldsFilled' },
        fieldsDetected: { $sum: '$fieldsDetected' },
        avgDuration: { $avg: '$durationMs' },
      } },
    ]),
    Application.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Application.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$ats', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 8 },
    ]),
    Application.aggregate([
      { $match: { userId: req.user._id, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Answer.countDocuments({ userId: req.user._id }),
    Resume.countDocuments({ userId: req.user._id }),
  ]);

  const t = totals[0] || {};
  // Every field the tool filled is a field the user did not retype. That is the
  // number worth surfacing, so we express saved time in the same units.
  const minutesSaved = Math.round(((t.fieldsFilled || 0) * 7) / 60);

  res.json({
    totalApplications: t.total || 0,
    fieldsFilled: t.fieldsFilled || 0,
    fieldsDetected: t.fieldsDetected || 0,
    avgDurationMs: Math.round(t.avgDuration || 0),
    minutesSaved,
    savedAnswers: answerCount,
    documents: resumeCount,
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    byAts: byAts.filter((a) => a._id).map((a) => ({ ats: a._id, count: a.count })),
    daily: recent.map((d) => ({ date: d._id, count: d.count })),
  });
}));

router.patch('/:id', ah(async (req, res) => {
  const patch = {};
  for (const k of ['status', 'notes', 'company', 'role']) if (req.body?.[k] !== undefined) patch[k] = req.body[k];

  const application = await Application.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: patch }, { new: true }).lean();
  if (!application) return res.status(404).json({ error: 'That application is not in your account.' });
  res.json({ application });
}));

router.delete('/:id', ah(async (req, res) => {
  const r = await Application.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!r) return res.status(404).json({ error: 'That application is not in your account.' });
  res.json({ deleted: true });
}));

export default router;
