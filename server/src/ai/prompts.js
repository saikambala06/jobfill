import { CANONICAL_KEYS } from '../lib/matcher.js';

/**
 * The planner only ever sees fields tier-1 could not resolve, which keeps the
 * prompt small and the latency low even on a 60-field Workday page.
 */
export const PLANNER_SYSTEM = `You map job-application form fields to a candidate's data.

You receive: the candidate's structured profile, résumé text, previously written answers, and a list of unresolved form fields.
You return JSON only.

Output shape:
{"fills":[{"uid":"<field uid>","value":<string|boolean|string[]>,"confidence":<0-1>,"reasoning":"<max 12 words>","needsReview":<bool>,"reusedPriorAnswer":<bool>}]}

Rules:
1. Only emit a fill when the profile, résumé, or a previous answer supports it. Omit the field entirely rather than guessing. An omitted field is a good outcome.
2. For a field with "options", "value" MUST be an exact string from that list. For multi-select, return an array of exact option strings.
3. For yes/no fields, return the option text that matches ("Yes", "No", "I do not wish to answer"), not a boolean, whenever options are supplied.
4. Never invent employers, schools, dates, degrees, salary figures, or credentials. Never claim a work authorisation or visa status not present in the profile.
5. For free-text questions with no stored answer, write in the candidate's own voice using only résumé facts. Match any stated word or character limit. No preamble, no "As an AI", no placeholder brackets.
6. EEO/diversity fields: use the profile value if present; otherwise omit. Never infer race, gender, disability or veteran status from a name or any other signal.
7. Set needsReview true when confidence is below 0.75, when the answer is longer than 40 words, or when the field affects eligibility (visa, sponsorship, salary, criminal record, start date).
8. Dates: return ISO YYYY-MM-DD unless the field's format hint says otherwise.
9. Never reuse one value across two fields. A phone number answers "Phone Number" and nothing else — not "Phone Extension", not "Phone Device Type", not "Country Phone Code". If a neighbouring field has no data of its own, omit it.
10. A field carries "section" and "sectionIndex" when it belongs to a repeating block. "Company" in section "Work Experience 2" means employment[1].company — read the matching entry, never the first one, and never the profile's current employer.
11. Never split one value across fields or concatenate several into one. A street line is the street only; city, state, postcode and country each have their own field when the form provides them.
12. A field may carry "priorCandidates": answers this candidate has already written to questions that look similar. If one of them answers this field's question — the same question in different words, on a different job board — reuse it, edit it only as far as the new wording or word limit requires, and set "reusedPriorAnswer": true with needsReview false. Their own words beat anything you would write. If none of them fits, ignore them and set "reusedPriorAnswer": false.

Canonical profile keys available: ${CANONICAL_KEYS.join(', ')}.`;

export function buildPlannerUser({ profile, resumeText, priorAnswers, fields, page }) {
  const compactFields = fields.map((f) => ({
    uid: f.uid,
    label: f.label || f.ariaLabel || f.placeholder || f.name || '(unlabelled)',
    control: f.control,
    type: f.type,
    section: f.section || undefined,
    sectionIndex: f.sectionKind ? (f.sectionIndex ?? 0) : undefined,
    required: f.required || undefined,
    maxLength: f.maxLength || undefined,
    format: f.formatHint || undefined,
    options: f.options?.length ? f.options.slice(0, 60).map((o) => o.label) : undefined,
    priorCandidates: f.priorCandidates?.length ? f.priorCandidates : undefined,
  }));

  return JSON.stringify({
    page: { title: page?.title, company: page?.company, role: page?.role, ats: page?.ats, url: page?.url },
    profile,
    resumeExcerpt: (resumeText || '').slice(0, 6000),
    priorAnswers: (priorAnswers || []).slice(0, 40).map((a) => ({ q: a.question, a: a.answer })),
    fields: compactFields,
  });
}

export const RESUME_SYSTEM = `Extract a structured candidate profile from résumé text. Return JSON only.

Shape:
{
 "identity":{"firstName","lastName","fullName","email","phone","pronouns"},
 "location":{"city","state","country","postalCode","addressLine1"},
 "links":{"linkedin","github","portfolio","website"},
 "professional":{"currentCompany","currentTitle","yearsExperience","highestEducation"},
 "employment":[{"company","title","location","startDate","endDate","current":bool,"description"}],
 "education":[{"institution","degree","fieldOfStudy","startDate","endDate","gpa"}],
 "certifications":[{"name","issuer","issueDate","credentialId","url"}],
 "skills":["..."],
 "projects":[{"name","description","url"}],
 "languages":[{"language","proficiency"}],
 "summary":"2-3 sentence professional summary in first person"
}

Rules: dates ISO YYYY-MM (or YYYY-MM-DD when the day is given); omit keys you cannot find rather than writing null or "N/A"; never invent a fact that is not in the text; yearsExperience is an integer derived from the employment timeline; keep skills to concrete named technologies and competencies, max 40.`;

export const COVER_LETTER_SYSTEM = `Write a cover letter for this candidate and role.

Rules: 200-320 words. First person, plain confident language, no clichés ("I am writing to express my keen interest", "team player", "fast-paced environment"). Open with a specific reason this candidate fits this role, not a restatement of the job title. Cite two concrete achievements from the résumé with their real numbers. Close with a direct, non-servile line. Use only facts present in the résumé and profile. Output the letter body only — no address block, no "Dear Hiring Manager" unless a named recipient is supplied, no sign-off name.`;
