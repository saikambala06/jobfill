import { matchField, readProfileValue } from '../server/src/lib/matcher.js';
import { questionSimilarity, findBestAnswer, bestOption } from '../server/src/lib/similarity.js';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ✗ ${name}\n      got: ${got}\n     want: ${want}`);
};

console.log('\n── field matching: real ATS labels ──────────────────────');
const cases = [
  [{ label: 'First Name *', name: 'first_name' }, 'firstName'],
  [{ label: 'Last Name', name: 'last_name' }, 'lastName'],
  [{ label: 'Email', type: 'email' }, 'email'],
  [{ label: 'Mobile phone number', type: 'tel' }, 'phone'],
  [{ label: 'LinkedIn Profile' }, 'linkedin'],
  [{ label: 'GitHub URL' }, 'github'],
  [{ label: 'Website' }, 'website'],
  [{ label: 'City' }, 'city'],
  [{ label: 'State/Province' }, 'state'],
  [{ label: 'Country of residence' }, 'country'],
  [{ label: 'Zip / Postal Code' }, 'postalCode'],
  [{ label: 'Are you legally authorized to work in the United States?', control: 'radio', options: [{label:'Yes'},{label:'No'}] }, 'workAuthorized'],
  [{ label: 'Will you now or in the future require sponsorship for employment visa status?', control: 'radio', options: [{label:'Yes'},{label:'No'}] }, 'requiresSponsorship'],
  [{ label: 'Desired salary' }, 'expectedSalary'],
  [{ label: 'What is your current CTC?' }, 'currentSalary'],
  [{ label: 'Notice period' }, 'noticePeriod'],
  [{ label: 'Are you willing to relocate?', control: 'radio', options: [{label:'Yes'},{label:'No'}] }, 'willingToRelocate'],
  [{ label: 'Resume/CV', type: 'file', control: 'file' }, 'resume'],
  [{ label: 'Cover Letter', type: 'file', control: 'file' }, 'coverLetter'],
  [{ label: 'How did you hear about this job?' }, 'referralSource'],
  [{ label: 'Current Employer' }, 'currentCompany'],
  [{ label: 'Current Job Title' }, 'currentTitle'],
  [{ label: 'Years of relevant experience', type: 'number' }, 'yearsExperience'],
  [{ label: 'Veteran Status' }, 'veteranStatus'],
  [{ label: 'Disability Status (Form CC-305)' }, 'disabilityStatus'],
  [{ label: 'Gender' }, 'gender'],
  [{ label: 'Highest level of education completed' }, 'highestEducation'],
  [{ label: 'Have you previously worked for our company?', control:'radio', options:[{label:'Yes'},{label:'No'}] }, 'previouslyEmployedHere'],
  // autocomplete beats text heuristics
  [{ label: 'Nombre', autocomplete: 'given-name' }, 'firstName'],
  // Workday-style humanized automation ids
  [{ label: 'Legal Name Given Name' }, 'firstName'],
];
for (const [field, want] of cases) {
  const m = matchField({ options: [], ...field });
  t(field.label, m?.key ?? 'null', want);
}

console.log('\n── negative matching (the hard part) ────────────────────');
// These MUST NOT match — they are the classic false positives.
const negatives = [
  [{ label: 'Why do you want to work at our company?' }, 'currentCompany'],
  [{ label: 'Confirm email address' }, 'email'],
  [{ label: 'Which country are you applying from?' }, null],
  [{ label: 'Phone country code' }, 'phone'],
  // buried keywords inside long behavioural questions must NOT map to a profile key
  [{ label: 'Describe a time you had to relocate a project deadline under pressure' }, 'willingToRelocate'],
  [{ label: 'Tell us about a time you had to travel to resolve a customer issue' }, 'willingToTravel'],
  [{ label: 'What city did you grow up in and how did it shape your work?' }, 'city'],
];
for (const [field, mustNotBe] of negatives) {
  const m = matchField({ options: [], ...field });
  const ok = m?.key !== mustNotBe;
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ✗ "${field.label}" wrongly matched ${mustNotBe}`);
}
console.log(`  "Why do you want to work at our company?" → ${matchField({label:'Why do you want to work at our company?',options:[]})?.key}`);
console.log(`  "Phone country code" → ${matchField({label:'Phone country code',options:[]})?.key}`);

console.log('\n── repeated-question detection ──────────────────────────');
const sims = [
  ['Why do you want to work at Acme?', 'Why are you interested in working at Stripe?'],
  ['Tell us about yourself', 'Tell us a bit about yourself'],
  ['What are your salary expectations?', 'What is your expected compensation?'],
  ['Why do you want this role?', 'Why did you leave your last role?'],
];
for (const [a, b] of sims) {
  const s = questionSimilarity(a, b);
  console.log(`  ${s.toFixed(2)}  "${a.slice(0,38)}" ~ "${b.slice(0,38)}"`);
}
// The last pair must be BELOW threshold; the first three above or near it.
t('similar questions match', questionSimilarity(sims[1][0], sims[1][1]) > 0.82, true);
t('different questions do not match', questionSimilarity(sims[3][0], sims[3][1]) < 0.82, true);

const stored = [{ question: 'Why do you want to work here?', answer: 'Because of the product.' }];
t('memory lookup hits', findBestAnswer('Why do you want to work here?', stored)?.entry.answer, 'Because of the product.');
t('memory lookup misses cleanly', findBestAnswer('What is your notice period?', stored), null);

console.log('\n── fuzzy option selection ───────────────────────────────');
const opts = [
  { value: 'us', label: 'United States' },
  { value: 'uk', label: 'United Kingdom' },
  { value: 'in', label: 'India' },
];
t('exact option', bestOption('India', opts)?.option.value, 'in');
t('partial option', bestOption('United States of America', opts)?.option.value, 'us');
t('no match returns null', bestOption('Antarctica', opts), null);

const yn = [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }];
t('boolean → option text', bestOption('Yes', yn)?.option.value, 'y');

console.log('\n── profile value resolution ─────────────────────────────');
const profile = {
  identity: { firstName: 'Priya', email: 'p@example.com' },
  eligibility: { requiresSponsorship: 'No' },
  compensation: { expectedSalary: '1800000' },
};
t('nested group lookup', readProfileValue(profile, 'firstName'), 'Priya');
t('eligibility lookup', readProfileValue(profile, 'requiresSponsorship'), 'No');
t('missing key is undefined', readProfileValue(profile, 'github'), undefined);

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
