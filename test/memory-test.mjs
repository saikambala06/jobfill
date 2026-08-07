/* The behaviours that were reported as bugs but live on the server side:
   deliberate blanks, one value never landing in two fields, section-scoped answer
   memory, and option matching that refuses to guess on a long list.            */
import { matchField, readProfileValue } from '../server/src/lib/matcher.js';
import { bestOption, findBestAnswer, normalizeQuestion } from '../server/src/lib/similarity.js';

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → got ${JSON.stringify(got)}` : ''}`); }
};

/* ---------------------------------------------------------- option picking */
console.log('\n── a long list must not be matched loosely ──────────────');
const dialCodes = [
  'Afghanistan (+93)', 'Albania (+355)', 'Algeria (+213)', 'Andorra (+376)',
  'Anguilla (+1)', 'Antigua (+1)', 'Argentina (+54)', 'Armenia (+374)',
  'Australia (+61)', 'Austria (+43)', 'Bahamas (+1)', 'Bahrain (+973)',
  'Bangladesh (+880)', 'Barbados (+1)', 'Belarus (+375)', 'Belgium (+32)',
  'Belize (+501)', 'Benin (+229)', 'Bermuda (+1)', 'Bhutan (+975)',
  'Bolivia (+591)', 'Botswana (+267)', 'Brazil (+55)', 'Bulgaria (+359)',
  'Canada (+1)', 'India (+91)', 'United Kingdom (+44)', 'United States of America (+1)',
].map((l) => ({ label: l, value: l }));

t('bare "+1" alone does not pick the first row',
  bestOption('+1', dialCodes)?.option.label !== 'Albania (+355)');
t('"+1" + country hint resolves to the US',
  bestOption('+1', dialCodes, 'United States')?.option.label === 'United States of America (+1)',
  bestOption('+1', dialCodes, 'United States')?.option.label);
t('"+91" + India resolves to India',
  bestOption('+91', dialCodes, 'India')?.option.label === 'India (+91)',
  bestOption('+91', dialCodes, 'India')?.option.label);
t('"United States" matches by word-prefix',
  bestOption('United States', dialCodes)?.option.label === 'United States of America (+1)',
  bestOption('United States', dialCodes)?.option.label);
t('nonsense on a long list returns null, not a guess',
  bestOption('Zzzqq', dialCodes) === null,
  bestOption('Zzzqq', dialCodes)?.option.label);
t('"in" does not match "India" on a prefix',
  bestOption('in', dialCodes)?.option.label !== 'India (+91)',
  bestOption('in', dialCodes)?.option.label);

console.log('\n── a short list can still be matched loosely ────────────');
const yesNo = [{ label: 'Yes', value: 'Yes' }, { label: 'No', value: 'No' }];
t('boolean true → "Yes"', bestOption('Yes', yesNo)?.option.label === 'Yes');
const sponsor = [
  { label: 'Yes, I will require sponsorship', value: 'y' },
  { label: 'No, I will not require sponsorship', value: 'n' },
];
t('"No" picks the negative option', bestOption('No', sponsor)?.option.value === 'n',
  bestOption('No', sponsor)?.option.value);

/* ------------------------------------------------- deliberate blank replay */
console.log('\n── a field saved blank stays blank ──────────────────────');
const scopeOf = (f) => (f.sectionKind ? `${f.sectionKind}:${f.sectionIndex ?? 0}` : '');
const stored = [
  { question: 'Phone Extension', scope: '', skipped: true, answer: '' },
  { question: 'Role Description', scope: 'employment:1', skipped: true, answer: '' },
  { question: 'Role Description', scope: 'employment:0', skipped: false, answer: 'Built ETL pipelines.' },
];
const blanks = new Set(stored.filter((a) => a.skipped)
  .map((a) => `${normalizeQuestion(a.question)}\u0000${a.scope || ''}`));
const isBlanked = (f) => blanks.has(`${normalizeQuestion(f.label)}\u0000${scopeOf(f)}`);

t('Phone Extension is skipped',
  isBlanked({ label: 'Phone Extension' }));
t('Work Exp 2 description is skipped',
  isBlanked({ label: 'Role Description', sectionKind: 'employment', sectionIndex: 1 }));
t('Work Exp 1 description is NOT skipped by it',
  !isBlanked({ label: 'Role Description', sectionKind: 'employment', sectionIndex: 0 }));

/* ------------------------------------------------ scoped answer memory ---- */
console.log('\n── saved answers stay in their own block ────────────────');
const usable = stored.filter((a) => !a.skipped && a.answer);
const poolFor = (f) => {
  const scope = scopeOf(f);
  const p = usable.filter((a) => (a.scope || '') === scope);
  return p.length ? p : (scope ? [] : usable);
};
const we0 = { label: 'Role Description', sectionKind: 'employment', sectionIndex: 0 };
const we2 = { label: 'Role Description', sectionKind: 'employment', sectionIndex: 2 };
t('Work Exp 1 finds its own saved description',
  findBestAnswer(we0.label, poolFor(we0))?.entry.answer === 'Built ETL pipelines.');
t('Work Exp 3 does not inherit Work Exp 1\'s description',
  findBestAnswer(we2.label, poolFor(we2)) === null);

/* --------------------------------------------- one value, one field ------- */
console.log('\n── one value cannot fill a whole group ──────────────────');
const NEVER_GUESS = /extension|\bext\b|ext\.|device\s*type|phone\s*type|country\s*(phone\s*)?code|phone\s*(country\s*)?code|dial|middle\s*initial|\bsuffix\b|confirm|verify|re-?enter/i;
for (const label of ['Phone Extension', 'Phone Device Type', 'Country Phone Code', 'Confirm Email', 'Middle Initial']) {
  t(`"${label}" is off-limits to the planner`, NEVER_GUESS.test(label));
}
t('"Phone Number" is still fair game', !NEVER_GUESS.test('Phone Number'));
t('"Role Description" is still fair game', !NEVER_GUESS.test('Role Description'));

const usedValues = new Map();
const claim = (value, key) => {
  const k = String(value).toLowerCase().trim();
  if (k.length > 2 && usedValues.has(k)) return false;
  usedValues.set(k, key);
  return true;
};
t('phone number is accepted for Phone Number', claim('(203) 935-4054', 'phone'));
t('the same number is refused a second field', !claim('(203) 935-4054', 'ai:f12'));
t('a different value is still accepted', claim('vineetha2341@gmail.com', 'email'));

/* ---------------------------------------------- repeating-block reads ----- */
console.log('\n── repeating blocks read their own entry ────────────────');
const profile = {
  identity: { phone: '(203) 935-4054' },
  employment: [
    { title: 'Senior Data Analyst', company: 'Optum' },
    { title: 'Data Analyst', company: 'Truist Bank' },
  ],
  education: [{ institution: 'University of North Texas' }, { institution: 'Anna University' }],
};
const fieldIn = (kind, index, label) => ({ label, sectionKind: kind, sectionIndex: index, control: 'text', type: 'text' });

const c1 = fieldIn('employment', 0, 'Company');
const c2 = fieldIn('employment', 1, 'Company');
t('employment[0].company', readProfileValue(profile, matchField(c1).key, c1) === 'Optum');
t('employment[1].company', readProfileValue(profile, matchField(c2).key, c2) === 'Truist Bank');

const s2 = fieldIn('education', 1, 'School or University');
t('education[1].institution', readProfileValue(profile, matchField(s2).key, s2) === 'Anna University');

const missing = fieldIn('employment', 5, 'Company');
t('a block with no data returns nothing, not entry 0',
  readProfileValue(profile, matchField(missing).key, missing) === undefined,
  readProfileValue(profile, matchField(missing).key, missing));

t('an unknown field inside a block does not fall back to flat rules',
  matchField(fieldIn('employment', 1, 'Phone')) === null,
  matchField(fieldIn('employment', 1, 'Phone'))?.key);

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
