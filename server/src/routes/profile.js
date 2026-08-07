import { Router } from 'express';
import { Profile } from '../models.js';
import { requireAuth, ah } from '../middleware.js';

const router = Router();
router.use(requireAuth);

const GROUPS = ['identity', 'location', 'links', 'professional', 'compensation', 'preferences', 'eligibility', 'demographics'];
const LISTS = ['employment', 'education', 'certifications', 'skills', 'languages', 'projects', 'references'];

/**
 * Completeness drives the dashboard progress rail. It is weighted, not a raw
 * field count: an email is worth more than a Dribbble URL.
 */
function scoreCompleteness(p) {
  const weighted = [
    [p.identity?.firstName, 4], [p.identity?.lastName, 4], [p.identity?.email, 4], [p.identity?.phone, 4],
    [p.location?.city, 3], [p.location?.country, 3], [p.location?.postalCode, 1],
    [p.links?.linkedin, 3], [p.links?.github, 2], [p.links?.portfolio, 1],
    [p.professional?.currentTitle, 3], [p.professional?.currentCompany, 3],
    [p.professional?.yearsExperience, 2], [p.professional?.summary, 3],
    [p.compensation?.expectedSalary, 3], [p.compensation?.noticePeriod, 2],
    [p.eligibility?.workAuthorized, 4], [p.eligibility?.requiresSponsorship, 4],
    [p.preferences?.willingToRelocate, 2], [p.preferences?.remotePreference, 2],
    [p.employment?.length, 6], [p.education?.length, 5], [p.skills?.length, 4],
  ];
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  const got = weighted.reduce((s, [v, w]) => s + (v ? w : 0), 0);
  return Math.round((got / total) * 100);
}

router.get('/', ah(async (req, res) => {
  let profile = await Profile.findOne({ userId: req.user._id }).lean();
  if (!profile) profile = (await Profile.create({ userId: req.user._id })).toObject();
  res.json({ profile });
}));

/** Deep merge on groups, replace on lists — matches how the dashboard edits them. */
router.put('/', ah(async (req, res) => {
  const body = req.body || {};
  const $set = {};

  for (const g of GROUPS) {
    if (!body[g] || typeof body[g] !== 'object') continue;
    for (const [k, v] of Object.entries(body[g])) $set[`${g}.${k}`] = v;
  }
  for (const l of LISTS) if (Array.isArray(body[l])) $set[l] = body[l];

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    { $set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  profile.completeness = scoreCompleteness(profile);
  await profile.save();

  res.json({ profile: profile.toObject() });
}));

/** Append one entry to a list section without resending the whole array. */
router.post('/:list', ah(async (req, res) => {
  const { list } = req.params;
  if (!LISTS.includes(list)) return res.status(400).json({ error: `Unknown profile section "${list}".` });

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user._id },
    { $push: { [list]: req.body } },
    { new: true, upsert: true },
  ).lean();
  res.json({ profile });
}));

router.delete('/:list/:index', ah(async (req, res) => {
  const { list, index } = req.params;
  if (!LISTS.includes(list)) return res.status(400).json({ error: `Unknown profile section "${list}".` });

  const profile = await Profile.findOne({ userId: req.user._id });
  profile[list].splice(Number(index), 1);
  await profile.save();
  res.json({ profile: profile.toObject() });
}));

export { scoreCompleteness };
export default router;
