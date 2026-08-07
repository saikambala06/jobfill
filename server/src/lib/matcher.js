/**
 * Tier-1 field matcher.
 *
 * Runs before any AI call. Deterministic, free, instant, and covers the long tail
 * of fields that every ATS asks in near-identical language. Whatever this cannot
 * resolve confidently is escalated to the AI planner.
 *
 * A rule maps a canonical profile key to the language ATSs actually use.
 * `deny` exists because "current company" and "company you are applying to" share
 * almost every keyword; negative matching is what keeps them apart.
 */

export const CANONICAL_KEYS = [
  // identity
  'firstName', 'lastName', 'middleName', 'fullName', 'preferredName', 'pronouns',
  'email', 'emailConfirm', 'phone', 'phoneCountryCode', 'phoneDeviceType', 'dateOfBirth',
  // location
  'addressLine1', 'addressLine2', 'city', 'state', 'country', 'postalCode',
  // links
  'linkedin', 'github', 'portfolio', 'website', 'twitter', 'stackoverflow', 'dribbble', 'behance',
  // professional
  'currentCompany', 'currentTitle', 'yearsExperience', 'highestEducation',
  'university', 'degree', 'fieldOfStudy', 'graduationYear', 'gpa',
  // compensation & logistics
  'currentSalary', 'expectedSalary', 'salaryCurrency', 'noticePeriod', 'availableFrom',
  'willingToRelocate', 'remotePreference', 'willingToTravel', 'workSchedule',
  // eligibility
  'workAuthorized', 'requiresSponsorship', 'visaStatus', 'hasDriversLicense',
  'criminalRecord', 'previouslyEmployedHere', 'over18',
  // sourcing
  'referralSource', 'referredBy', 'coverLetterText', 'whyThisCompany', 'additionalInfo',
  // EEO / voluntary
  'gender', 'ethnicity', 'veteranStatus', 'disabilityStatus', 'hispanicLatino',
  // documents
  'resume', 'coverLetter', 'transcript', 'portfolioFile',
  'previouslyApplied', 'relatedToEmployee', 'nonCompete',
  // repeating sections — resolved against profile.employment[i] / education[i]
  'employer.title', 'employer.company', 'employer.location', 'employer.startDate',
  'employer.endDate', 'employer.current', 'employer.description', 'employer.employmentType',
  'school.institution', 'school.degree', 'school.fieldOfStudy',
  'school.startDate', 'school.endDate', 'school.gpa',
];

const rx = (...parts) => new RegExp(parts.join('|'), 'i');

/** @type {{key:string, match:RegExp, deny?:RegExp, weight?:number, kind?:string}[]} */
export const RULES = [
  // ---- identity -----------------------------------------------------------
  { key: 'firstName', match: rx('\\bfirst\\s*name\\b', '\\bgiven\\s*name\\b', '\\bforename\\b', '^fname$', '\\bnome\\b'), deny: rx('last|family|sur') },
  { key: 'lastName', match: rx('\\blast\\s*name\\b', '\\bfamily\\s*name\\b', '\\bsurname\\b', '^lname$', '\\bapellido\\b'), deny: rx('first|given|maiden') },
  { key: 'middleName', match: rx('middle\\s*(name|initial)', '\\bmi\\b') },
  { key: 'preferredName', match: rx('preferred\\s*(name|first)', 'nickname', 'name you go by', 'what should we call you') },
  { key: 'fullName', match: rx('\\bfull\\s*name\\b', '^name$', '\\byour\\s*name\\b', 'legal name'), deny: rx('first|last|middle|preferred|user|company|school|reference|emergency'), weight: 0.8 },
  { key: 'pronouns', match: rx('pronoun') },
  // A "confirm" box is not a different question — it is the same answer typed
  // twice, and leaving it blank fails the form's own validation. It gets its own
  // rule (and its own key, so the duplicate-value guard knows the repeat is
  // intentional) rather than being denied outright.
  { key: 'emailConfirm', match: rx('(confirm|verify|re-?type|re-?enter|repeat)\\s*(your\\s*)?(valid\\s*)?e-?mail', 'e-?mail\\s*(confirm|again)'), kind: 'email', weight: 1.4 },
  { key: 'email', match: rx('e-?mail', 'correo'), deny: rx('confirm|verify|re-?enter|re-?type|repeat|alternate'), kind: 'email' },
  // Every deny term here is a field that sits *next to* the phone number on a real
  // form and used to inherit its value: the extension box, the device-type
  // dropdown, the dial-code picker. Matching "phone" alone put the same number in
  // all four.
  {
    key: 'phone',
    match: rx('phone', 'mobile', 'telephone', 'contact number', 'cell', '\\btel\\b'),
    deny: rx('country\\s*code|country\\s*phone|extension|\\bext\\b|ext\\.|device\\s*type|phone\\s*type|\\btype\\b|carrier|prefix|dial'),
    kind: 'tel',
  },
  { key: 'phoneCountryCode', match: rx('country\\s*phone\\s*code', 'phone\\s*country\\s*code', 'country\\s*code', 'phone\\s*prefix', 'dial(ling)?\\s*code', 'international\\s*code'), weight: 1.25 },
  { key: 'phoneDeviceType', match: rx('phone\\s*device\\s*type', 'device\\s*type', 'phone\\s*type'), weight: 1.25 },
  { key: 'dateOfBirth', match: rx('date of birth', '\\bdob\\b', 'birth\\s*date', 'birthday'), kind: 'date' },

  // ---- location -----------------------------------------------------------
  { key: 'addressLine1', match: rx('address\\s*(line)?\\s*1', 'street\\s*address', '^address$', 'mailing address'), deny: rx('email|ip\\b|line\\s*2|city|state|province|postal|zip|country') },
  { key: 'addressLine2', match: rx('address\\s*(line)?\\s*2', 'apt', 'suite', 'unit\\s*(no|number)?') },
  { key: 'city', match: rx('\\bcity\\b', '\\btown\\b', 'locality', 'current city', 'ciudad'), deny: rx('citizen|capacity') },
  { key: 'state', match: rx('\\bstate\\b', '\\bprovince\\b', '\\bregion\\b', 'county'), deny: rx('united states|statement|status') },
  // "Country/Region" really is the country; a bare "Region" beside a country field
  // is the state. The combined form gets its own higher-weight rule so the plain
  // one can safely deny `region` and stop stealing the state field.
  // These three had no rule at all, so a required Workday question came back blank
  // on every application. The other two — "How did you hear about us?" and "Have
  // you worked here before?" — already resolve to `referralSource` and
  // `previouslyEmployedHere`; what they lacked was somewhere in the profile to
  // read the answer from, which is now `profile.application`.
  { key: 'previouslyApplied', match: rx('previously applied', 'applied (here|to us|before)', 'submitted an application before'), kind: 'boolean', weight: 1.3 },
  { key: 'relatedToEmployee', match: rx('related to (an? )?(current )?employee', 'relative(s)? (who )?work', 'family member.{0,30}(employ|work)', 'know anyone who works'), kind: 'boolean', weight: 1.3 },
  { key: 'nonCompete', match: rx('non-?compete', 'restrictive covenant', 'bound by any (other )?agreement'), kind: 'boolean', weight: 1.3 },

  { key: 'country', match: rx('country\\s*/\\s*region', 'country or region'), weight: 1.3 },
  { key: 'country', match: rx('\\bcountry\\b', 'nation(ality)?', '\\bpa[ií]s\\b'), deny: rx('country\\s*code|country\\s*phone|phone|dial|region|which country are you applying') },
  { key: 'postalCode', match: rx('post(al)?\\s*code', '\\bzip\\b', '\\bpincode\\b', '\\bpin\\s*code\\b') },

  // ---- links --------------------------------------------------------------
  { key: 'linkedin', match: rx('linked\\s*-?in') },
  { key: 'github', match: rx('git\\s*hub', '\\bgit\\b') },
  { key: 'portfolio', match: rx('portfolio', 'behance|dribbble|artstation') },
  { key: 'website', match: rx('personal\\s*(web)?site', '\\bwebsite\\b', '\\bblog\\b', 'personal url', 'homepage'), deny: rx('company|employer') },
  { key: 'twitter', match: rx('twitter', '\\bx\\.com\\b') },
  { key: 'stackoverflow', match: rx('stack\\s*overflow') },

  // ---- professional -------------------------------------------------------
  { key: 'currentCompany', match: rx('current\\s*(employer|company)', 'present\\s*employer', 'most recent (employer|company)', '^company$', '^employer$'), deny: rx('why|apply|our company|this company|reason') },
  { key: 'currentTitle', match: rx('current\\s*(job\\s*)?title', 'current\\s*(role|position)', 'most recent (title|position)', '^job title$', 'designation'), deny: rx('applying|desired|this (role|position)') },
  { key: 'yearsExperience', match: rx('years? of (relevant )?(work )?experience', 'total experience', 'experience \\(years\\)', 'how many years'), kind: 'number' },
  { key: 'highestEducation', match: rx('highest (level of )?(education|degree|qualification)', 'education level') },
  { key: 'university', match: rx('university', 'college', 'school', 'institution', 'alma mater'), deny: rx('high school district|schedule') },
  { key: 'degree', match: rx('\\bdegree\\b', 'qualification'), deny: rx('highest|field|discipline') },
  { key: 'fieldOfStudy', match: rx('field of study', '\\bmajor\\b', 'discipline', 'specialization', 'concentration') },
  { key: 'graduationYear', match: rx('graduation (year|date)', 'year of (graduation|passing)', 'expected graduation', 'completion year') },
  { key: 'gpa', match: rx('\\bgpa\\b', 'grade point', 'percentage|cgpa') },

  // ---- compensation & logistics ------------------------------------------
  { key: 'expectedSalary', match: rx('(expected|desired|required)\\s*(salary|compensation|ctc|pay|rate)', 'salary expectation', 'compensation expectation', 'what are your salary'), deny: rx('current') },
  { key: 'currentSalary', match: rx('current\\s*(salary|ctc|compensation|pay)', 'present salary'), deny: rx('expect|desired') },
  { key: 'salaryCurrency', match: rx('currency') },
  { key: 'noticePeriod', match: rx('notice period', 'how soon can you (start|join)', 'availability to start', 'when can you start', 'earliest start') },
  { key: 'availableFrom', match: rx('available(ility)? (from|date)', 'start date', 'joining date'), kind: 'date' },
  { key: 'willingToRelocate', match: rx('relocat', 'willing to move'), kind: 'boolean' },
  { key: 'remotePreference', match: rx('remote', 'hybrid', 'on-?site', 'work (location|arrangement|preference|model)', 'in-?office') },
  { key: 'willingToTravel', match: rx('travel'), kind: 'boolean' },
  { key: 'workSchedule', match: rx('shift', 'work schedule', 'full-?time or part-?time', 'employment type') },

  // ---- eligibility --------------------------------------------------------
  {
    key: 'requiresSponsorship',
    match: rx('sponsor', 'require.*visa', 'need.*work permit', 'immigration (status|support)'),
    kind: 'boolean', weight: 1.2,
  },
  {
    key: 'workAuthorized',
    match: rx('legally (authoriz|entitl)', 'authoriz(ed|ation) to work', 'right to work', 'eligible to work', 'work permit', 'permitted to work'),
    deny: rx('sponsor'), kind: 'boolean', weight: 1.2,
  },
  { key: 'visaStatus', match: rx('visa (status|type)', 'work authorization (status|type)', 'immigration status', 'citizenship status', '\\bh-?1b\\b|\\bopt\\b|\\bcpt\\b|\\bgreen card\\b') },
  { key: 'hasDriversLicense', match: rx("driver'?s? licen[cs]e", 'driving licen[cs]e'), kind: 'boolean' },
  { key: 'criminalRecord', match: rx('convicted', 'criminal (record|history|conviction)', 'felony'), kind: 'boolean' },
  { key: 'previouslyEmployedHere', match: rx('previously (worked|employed|applied)', 'former employee', 'worked (here|for us|at this company)', 'rehire'), kind: 'boolean' },
  { key: 'over18', match: rx('(at least|over|older than) 1[68]', 'age of majority', 'are you 18'), kind: 'boolean' },

  // ---- sourcing & narrative ----------------------------------------------
  { key: 'referralSource', match: rx('how did you (hear|find)', 'where did you (hear|find)', 'source', 'how were you referred'), deny: rx('referred by|referrer name') },
  { key: 'referredBy', match: rx('referred by', 'referrer', 'employee referral name', 'who referred') },
  { key: 'whyThisCompany', match: rx('why (do you want|are you interested|this|our)', 'what (interests|excites|draws) you', 'why should we') },
  { key: 'coverLetterText', match: rx('cover letter'), deny: rx('upload|attach|file|resume') },
  { key: 'additionalInfo', match: rx('additional (information|comments|details)', 'anything else', 'other comments', 'is there anything') },

  // ---- EEO / voluntary ----------------------------------------------------
  { key: 'gender', match: rx('\\bgender\\b', '\\bsex\\b'), deny: rx('orientation') },
  { key: 'hispanicLatino', match: rx('hispanic', 'latino|latinx') },
  { key: 'ethnicity', match: rx('ethnic', '\\brace\\b', 'racial') },
  { key: 'veteranStatus', match: rx('veteran', 'military service', 'protected veteran') },
  { key: 'disabilityStatus', match: rx('disab', 'form cc-?305') },

  // ---- documents ----------------------------------------------------------
  { key: 'resume', match: rx('resume', '\\bcv\\b', 'curriculum vitae'), kind: 'file', weight: 1.3 },
  { key: 'coverLetter', match: rx('cover letter', 'motivation letter'), kind: 'file', weight: 1.3 },
  { key: 'transcript', match: rx('transcript'), kind: 'file' },
  { key: 'portfolioFile', match: rx('portfolio|work sample'), kind: 'file' },
];

/**
 * Rules that only apply inside a repeating block.
 *
 * "Company" means the current employer on a personal-details page and the second
 * job's employer inside "Work Experience 2". The same string, two different
 * answers — so the section decides which rule set is even eligible. Without this
 * every entry resolved to the same flat profile key and every job showed the same
 * employer.
 */
export const SECTION_RULES = {
  employment: [
    { key: 'employer.title', match: rx('job\\s*title', 'position\\s*title', '^title$', '\\brole\\b', 'designation', 'position'), deny: rx('company|employer') },
    { key: 'employer.company', match: rx('company', 'employer', 'organi[sz]ation', 'firm'), deny: rx('title|role|size|industry') },
    { key: 'employer.location', match: rx('location', '\\bcity\\b', '\\bcountry\\b', 'where') },
    { key: 'employer.employmentType', match: rx('employment\\s*type', 'job\\s*type', 'full.?time|part.?time') },
    { key: 'employer.startDate', match: rx('^from$', 'start\\s*date', 'from\\s*date', '\\bfrom\\b'), deny: rx('\\bto\\b|end'), kind: 'date' },
    { key: 'employer.endDate', match: rx('^to$', 'end\\s*date', 'to\\s*date', '\\bto\\b'), deny: rx('from|start'), kind: 'date' },
    { key: 'employer.current', match: rx('currently\\s*work', 'current(ly)?\\s*(employed|here)', 'i\\s*currently', 'present\\s*role'), kind: 'boolean' },
    { key: 'employer.description', match: rx('role\\s*description', 'description', 'responsibilit', 'duties', 'achievement', 'summary') },
  ],
  education: [
    { key: 'school.institution', match: rx('school', 'university', 'college', 'institution', 'academy'), deny: rx('degree|study|major|type') },
    { key: 'school.degree', match: rx('\\bdegree\\b', 'qualification', 'level of study'), deny: rx('field|major|discipline') },
    { key: 'school.fieldOfStudy', match: rx('field\\s*of\\s*study', '\\bmajor\\b', 'discipline', 'specializ', 'concentration', 'subject') },
    { key: 'school.startDate', match: rx('^from$', 'start\\s*date', '\\bfrom\\b'), deny: rx('\\bto\\b|end|graduat'), kind: 'date' },
    { key: 'school.endDate', match: rx('^to$', 'end\\s*date', 'graduation', 'year of (graduation|passing)', '\\bto\\b'), deny: rx('from|start'), kind: 'date' },
    { key: 'school.gpa', match: rx('\\bgpa\\b', 'grade point', 'cgpa', 'percentage', 'marks') },
  ],
};

/** Everything we know about a field, flattened into one searchable string. */
export function fieldHaystack(field, { includeSection = true } = {}) {
  return [
    field.label, field.name, field.id, field.placeholder, field.ariaLabel,
    field.description, includeSection ? field.section : '', field.autocomplete,
  ].filter(Boolean).join(' ⋄ ').toLowerCase();
}

/**
 * HTML `autocomplete` tokens are a free, spec-defined signal that a surprising
 * number of ATSs actually emit. When present they beat any text heuristic.
 */
const AUTOCOMPLETE_MAP = {
  'given-name': 'firstName', 'family-name': 'lastName', 'additional-name': 'middleName',
  name: 'fullName', nickname: 'preferredName', email: 'email', tel: 'phone',
  'tel-country-code': 'phoneCountryCode', bday: 'dateOfBirth', organization: 'currentCompany',
  'organization-title': 'currentTitle', url: 'website', 'street-address': 'addressLine1',
  'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
  'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode',
  country: 'country', 'country-name': 'country',
};

/** Score one field against one rule set. Shared by the flat and section passes. */
function scoreAgainst(rules, field, hay, labelText) {
  const isQuestion = labelText.length > 45 || labelText.includes('?');
  const isFileControl = field.control === 'file' || field.type === 'file';

  let best = null;
  for (const rule of rules) {
    if (rule.deny && rule.deny.test(hay)) continue;
    // Control type is a hard constraint, not a tiebreaker. "Cover Letter" as an
    // upload is the document; as a textarea it is the written text. Scoring alone
    // cannot separate them because the label is identical.
    if (isFileControl !== (rule.kind === 'file')) continue;

    // Regex alternation returns the *first* match, not the longest. "Zip / Postal
    // Code" would otherwise score on "zip" alone and lose to its own better match.
    let hit = null;
    for (const m of hay.matchAll(new RegExp(rule.match.source, 'gi'))) {
      if (!hit || m[0].length > hit.length) hit = m[0];
    }
    if (!hit) continue;

    const coverage = Math.min(1, hit.length / Math.max(10, labelText.length));
    let score = isQuestion ? 0.55 + coverage * 0.45 : 0.72 + coverage * 0.25;

    // Labels lead with their subject, so an early match is the real one.
    if (hay.indexOf(hit) < Math.max(10, labelText.length) * 0.5) score += 0.05;

    // "Are you authorised to work…" / "Will you require sponsorship…" — an
    // interrogative opener on a yes/no rule is exactly the shape we want.
    if (rule.kind === 'boolean' && /^(are|is|do|does|did|will|would|have|has|can|may)\b/.test(labelText.toLowerCase())) {
      score += 0.12;
    }

    score *= (rule.weight || 1);

    // Type agreement is corroborating evidence.
    if (rule.kind === 'file' && field.type === 'file') score += 0.15;
    if (rule.kind === 'email' && field.type === 'email') score += 0.12;
    if (rule.kind === 'tel' && field.type === 'tel') score += 0.12;
    if (rule.kind === 'date' && (field.type === 'date' || field.type === 'month')) score += 0.12;
    if (rule.kind === 'boolean' && field.control === 'radio' && field.options?.length <= 3) score += 0.1;
    if (rule.kind === 'boolean' && field.control === 'checkbox') score += 0.1;
    if (rule.kind === 'number' && field.type === 'number') score += 0.1;

    // The cap is applied on the way out, not here — clamping inside the loop would
    // flatten two strong candidates into a tie and hand the win to rule order.
    if (!best || score > best.confidence) best = { key: rule.key, confidence: score, via: 'rule', kind: rule.kind };
  }
  return best;
}

/**
 * Resolve one field to a canonical profile key.
 * Returns null when nothing clears the confidence floor — that field goes to the AI.
 */
export function matchField(field) {
  const ac = (field.autocomplete || '').toLowerCase().split(/\s+/).pop();
  if (AUTOCOMPLETE_MAP[ac]) {
    return { key: AUTOCOMPLETE_MAP[ac], confidence: 0.97, via: 'autocomplete' };
  }

  const labelText = (field.label || '').trim();

  // A field inside a repeating block is answered from that block's own rule set.
  // The section text is deliberately kept out of the haystack here: leaving
  // "Work Experience 2" in it made the employment keyword match on every field in
  // the block, which is the flat-profile collapse this guards against.
  const scoped = SECTION_RULES[field.sectionKind];
  if (scoped) {
    const scopedHay = fieldHaystack(field, { includeSection: false });
    const hit = scopedHay.trim()
      ? scoreAgainst(scoped, field, scopedHay, labelText || scopedHay)
      : null;
    if (hit && hit.confidence >= 0.7) {
      return { ...hit, confidence: Math.min(0.99, hit.confidence), sectionIndex: field.sectionIndex || 0 };
    }
    // An unrecognised field inside a repeating block must not fall through to the
    // flat rules — that is exactly how "Company" in Work Experience 2 used to be
    // answered with the candidate's current employer.
    if (['employment', 'education'].includes(field.sectionKind)) return null;
  }

  const hay = fieldHaystack(field);
  if (!hay.trim()) return null;

  const best = scoreAgainst(RULES, field, hay, labelText || hay);
  if (!best || best.confidence < 0.7) return null;
  return { ...best, confidence: Math.min(0.99, best.confidence) };
}

/* --------------------------------------------------------- profile reads -- */
const PROFILE_GROUPS = ['identity', 'location', 'links', 'professional', 'compensation', 'eligibility', 'demographics', 'preferences', 'application'];

/**
 * Trailing "City, ST 12345" that a résumé parser folded into the street line.
 *
 * Two passes. The first strips the parts the profile already knows, which is exact
 * and safe. The second is for profiles that only ever captured one address blob
 * and have no city or postcode of their own to match against — without it those
 * users still get the whole address in Address Line 1 and the form rejects it.
 */
function streetOnly(line, loc = {}) {
  let out = String(line);

  for (const part of [loc.postalCode, loc.country, loc.state, loc.city]) {
    if (!part) continue;
    const esc = String(part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`[,\\s]*\\b${esc}\\b[,\\s]*$`, 'i'), '');
  }
  out = out.replace(/[\s,]+$/, '').trim();

  // A trailing city name is only safe to remove once something has confirmed this
  // really is a whole address — a postcode or a state code at the end. Without
  // that anchor "Flat 3, Heritage Trail" would lose its street name, so an
  // unanchored line is left exactly as the user wrote it.
  if (out.includes(',')) {
    const before = out;
    let anchored = false;

    const noPostcode = out.replace(/,\s*(\d{5}(-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{6})\s*$/i, '');
    if (noPostcode !== out) { anchored = true; out = noPostcode; }

    const noState = out.replace(/,\s*[A-Z]{2}\s*$/, '');
    if (noState !== out) { anchored = true; out = noState; }

    if (anchored) out = out.replace(/,\s*[A-Za-z .'-]{2,30}\s*$/, '');
    if (out.trim().length < 4) out = before;
  }

  return out.replace(/[\s,]+$/, '').trim() || String(line);
}

/**
 * Resolve a canonical key against the stored profile.
 *
 * `field` carries the section index, so `employer.company` on the second Work
 * Experience block reads `profile.employment[1].company` rather than collapsing
 * every entry onto the same record.
 */
/** Keys that are deliberately a second copy of another key's value. */
const ALIASES = { emailConfirm: 'email' };

export function readProfileValue(profile, key, field) {
  if (!profile || !key) return undefined;
  if (ALIASES[key]) return readProfileValue(profile, ALIASES[key], field);

  if (key.includes('.')) {
    const [group, leaf] = key.split('.');
    const list = group === 'employer' ? profile.employment
      : group === 'school' ? profile.education
        : null;
    if (!Array.isArray(list)) return undefined;
    const entry = list[field?.sectionIndex ?? 0];
    const v = entry?.[leaf];
    return v === undefined || v === null || v === '' ? undefined : v;
  }

  const direct = profile[key];
  if (direct !== undefined && direct !== null && direct !== '') {
    return key === 'addressLine1' ? streetOnly(direct, profile.location) : direct;
  }

  for (const group of PROFILE_GROUPS) {
    const v = profile[group]?.[key];
    if (v !== undefined && v !== null && v !== '') {
      return key === 'addressLine1' ? streetOnly(v, profile.location) : v;
    }
  }
  return undefined;
}
