import { Router } from 'express';
import multer from 'multer';
import { Resume, Profile } from '../models.js';
import { requireAuth, rateLimit, ah } from '../middleware.js';
import { extractText, cleanText, parseResume } from '../lib/resumeParser.js';
import { scoreCompleteness } from './profile.js';

const router = Router();
router.use(requireAuth);

const MAX_INLINE = 4 * 1024 * 1024; // Mongo docs cap at 16MB; stay well clear.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.get('/', ah(async (req, res) => {
  const resumes = await Resume.find({ userId: req.user._id })
    .select('-data -extractedText')
    .sort({ isDefault: -1, createdAt: -1 })
    .lean();
  res.json({ resumes });
}));

/**
 * Upload → extract text → structure with AI → merge into the profile.
 * The merge is non-destructive: anything the user already typed wins over
 * anything the model inferred, because the user is the authority on their own data.
 */
router.post('/', rateLimit({ max: 10, windowMs: 300_000 }), upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Attach a file to upload.' });
  if (req.file.size > MAX_INLINE) {
    return res.status(413).json({ error: 'That file is over 4 MB. Upload a smaller version.' });
  }

  const kind = ['resume', 'coverLetter', 'transcript', 'portfolio', 'other'].includes(req.body.kind)
    ? req.body.kind : 'resume';

  const raw = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
  const text = cleanText(raw);

  const makeDefault = req.body.isDefault === 'true' || !(await Resume.exists({ userId: req.user._id, kind }));
  if (makeDefault) await Resume.updateMany({ userId: req.user._id, kind }, { $set: { isDefault: false } });

  const resume = await Resume.create({
    userId: req.user._id,
    label: req.body.label?.trim() || req.file.originalname.replace(/\.[^.]+$/, ''),
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    kind,
    data: req.file.buffer,
    extractedText: text,
    isDefault: makeDefault,
  });

  let merged = null;
  if (kind === 'resume' && text.length > 120 && req.body.parse !== 'false') {
    try {
      const parsed = await parseResume(text, req.user.settings?.aiProvider);
      const profile = await Profile.findOneAndUpdate(
        { userId: req.user._id }, {}, { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      for (const group of ['identity', 'location', 'links', 'professional']) {
        for (const [k, v] of Object.entries(parsed[group] || {})) {
          if (v && !profile[group]?.[k]) profile[group][k] = v; // user-entered values are never overwritten
        }
      }
      for (const list of ['employment', 'education', 'certifications', 'projects', 'languages']) {
        if (!profile[list]?.length && parsed[list]?.length) profile[list] = parsed[list];
      }
      if (!profile.skills?.length && parsed.skills?.length) profile.skills = parsed.skills;

      profile.completeness = scoreCompleteness(profile);
      await profile.save();
      resume.parsedAt = new Date();
      await resume.save();
      merged = profile.toObject();
    } catch (err) {
      // A parsing failure must not lose the upload — the file is already saved.
      console.error('[resume-parse]', err.message);
    }
  }

  const { data, extractedText, ...meta } = resume.toObject();
  res.status(201).json({
    resume: meta,
    profile: merged,
    parsed: Boolean(merged),
    message: merged ? 'Résumé saved and profile updated.' : 'Résumé saved.',
  });
}));

/** Served as a data URL so the content script can rebuild a File and attach it. */
router.get('/:id/file', ah(async (req, res) => {
  const resume = await Resume.findOne({ _id: req.params.id, userId: req.user._id }).lean();
  if (!resume) return res.status(404).json({ error: 'That file is no longer in your account.' });

  res.json({
    filename: resume.filename,
    mimeType: resume.mimeType,
    size: resume.size,
    dataUrl: `data:${resume.mimeType};base64,${resume.data.toString('base64')}`,
  });
}));

router.get('/:id/text', ah(async (req, res) => {
  const resume = await Resume.findOne({ _id: req.params.id, userId: req.user._id }).select('extractedText label').lean();
  if (!resume) return res.status(404).json({ error: 'That file is no longer in your account.' });
  res.json({ label: resume.label, text: resume.extractedText });
}));

router.patch('/:id', ah(async (req, res) => {
  const resume = await Resume.findOne({ _id: req.params.id, userId: req.user._id });
  if (!resume) return res.status(404).json({ error: 'That file is no longer in your account.' });

  if (req.body.label !== undefined) resume.label = String(req.body.label).trim();
  if (req.body.isDefault === true) {
    await Resume.updateMany({ userId: req.user._id, kind: resume.kind }, { $set: { isDefault: false } });
    resume.isDefault = true;
  }
  await resume.save();

  const { data, extractedText, ...meta } = resume.toObject();
  res.json({ resume: meta });
}));

router.delete('/:id', ah(async (req, res) => {
  const r = await Resume.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!r) return res.status(404).json({ error: 'That file is no longer in your account.' });

  // Never leave a kind without a default.
  if (r.isDefault) {
    const next = await Resume.findOne({ userId: req.user._id, kind: r.kind }).sort({ createdAt: -1 });
    if (next) { next.isDefault = true; await next.save(); }
  }
  res.json({ deleted: true });
}));

export default router;
