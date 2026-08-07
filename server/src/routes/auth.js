import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, Profile } from '../models.js';
import { signToken, requireAuth, rateLimit, ah } from '../middleware.js';

const router = Router();
const publicUser = (u) => ({
  id: u._id, email: u.email, name: u.name, plan: u.plan,
  settings: u.settings, usage: u.usage, createdAt: u.createdAt,
});

router.post('/register', rateLimit({ max: 8, windowMs: 600_000, key: (r) => r.ip }), ah(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.status(409).json({ error: 'An account already uses this email. Sign in instead.' });

  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    name: name?.trim(),
  });
  // Every user gets a profile document immediately so the dashboard never has to
  // branch on "profile might not exist yet".
  await Profile.create({ userId: user._id, identity: { email: user.email, fullName: name?.trim() } });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', rateLimit({ max: 12, windowMs: 600_000, key: (r) => r.ip }), ah(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() });
  // Same message either way — revealing which half was wrong helps enumeration.
  const ok = user && await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'That email and password do not match.' });

  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

router.patch('/settings', requireAuth, ah(async (req, res) => {
  const allowed = ['autofillOnOpen', 'confirmBeforeSubmit', 'generateMissingAnswers', 'fillEEO', 'aiProvider'];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) patch[`settings.${k}`] = req.body[k];
  if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();

  const user = await User.findByIdAndUpdate(req.user._id, { $set: patch }, { new: true }).lean();
  res.json({ user: publicUser(user) });
}));

router.post('/password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });

  const user = await User.findById(req.user._id);
  if (!await bcrypt.compare(String(currentPassword || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.tokenVersion += 1; // signs out every other device
  await user.save();

  res.json({ token: signToken(user), user: publicUser(user) });
}));

export default router;
