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
  'email', 'phone', 'phoneCountryCode', 'dateOfBirth',
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
  { key: 'email', match: rx('e-?mail', 'correo'), deny: rx('confirm|verify|re-?enter|alternate'), kind: 'email' },
  { key: 'phone', match: rx('phone', 'mobile', 'telephone', 'contact number', 'cell', '\\btel\\b'), deny: rx('country\\s*code|extension|ext\\.'), kind: 'tel' },
  { key: 'phoneCountryCode', match: rx('country\\s*code', 'phone\\s*prefix', 'dial\\s*code') },
  { key: 'dateOfBirth', match: rx('date of birth', '\\bdob\\b', 'birth\\s*date', 'birthday'), kind: 'date' },

  // ---- location -----------------------------------------------------------
  { key: 'addressLine1', match: rx('address\\s*(line)?\\s*1', 'street\\s*address', '^address$', 'mailing address'), deny: rx('email|ip\\b|line\\s*2') },
  { key: 'addressLine2', match: rx('address\\s*(line)?\\s*2', 'apt', 'suite', 'unit\\s*(no|number)?') },
  { key: 'city', match: rx('\\bcity\\b', '\\btown\\b', 'locality', 'current city', 'ciudad'), deny: rx('citizen|capacity') },
  { key: 'state', match: rx('\\bstate\\b', '\\bprovince\\b', '\\bregion\\b', 'county'), deny: rx('united states|statement|status') },
  { key: 'country', match: rx('\\bcountry\\b', 'nation(ality)?', '\\bpa[ií]s\\b'), deny: rx('country\\s*code|which country are you applying') },
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

/** Everything we know about a field, flattened into one searchable string. */
export function fieldHaystack(field) {
  return [
    field.label, field.name, field.id, field.placeholder, field.ariaLabel,
    field.description, field.section, field.autocomplete,
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

/**
 * Score one field against every rule and keep the best.
 * Returns null when nothing clears the confidence floor — that field goes to the AI.
 */
export function matchField(field) {
  const ac = (field.autocomplete || '').toLowerCase().split(/\s+/).pop();
  if (AUTOCOMPLETE_MAP[ac]) {
    return { key: AUTOCOMPLETE_MAP[ac], confidence: 0.97, via: 'autocomplete' };
  }

  const hay = fieldHaystack(field);
  if (!hay.trim()) return null;

  const labelText = (field.label || hay).trim();
  // Long or interrogative text is a *question*, not a field label. A keyword buried
  // in one is weak evidence ("describe a time you had to relocate a deadline" is not
  // a relocation question), so questions start from a lower base and must earn more.
  const isQuestion = labelText.length > 45 || labelText.includes('?');

  const isFileControl = field.control === 'file' || field.type === 'file';

  let best = null;
  for (const rule of RULES) {
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
    if (rule.kind === 'number' && field.type === 'number') score += 0.1;

    // The cap is applied on the way out, not here — clamping inside the loop would
    // flatten two strong candidates into a tie and hand the win to rule order.
    if (!best || score > best.confidence) best = { key: rule.key, confidence: score, via: 'rule', kind: rule.kind };
  }

  if (!best || best.confidence < 0.7) return null;
  return { ...best, confidence: Math.min(0.99, best.confidence) };
}

/** Resolve a canonical key against the stored profile, flattening nested groups. */
export function readProfileValue(profile, key) {
  if (!profile) return undefined;
  const direct = profile[key];
  if (direct !== undefined && direct !== null && direct !== '') return direct;

  for (const group of ['identity', 'location', 'links', 'professional', 'compensation', 'eligibility', 'demographics', 'preferences']) {
    const v = profile[group]?.[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
