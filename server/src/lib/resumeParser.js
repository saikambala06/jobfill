import { complete } from '../ai/provider.js';
import { RESUME_SYSTEM } from '../ai/prompts.js';

/**
 * pdf-parse@1.x decides it is in "debug mode" when `module.parent` is falsy —
 * which is always the case under ESM — and then tries to read a test PDF that is
 * not shipped, throwing ENOENT on import. Importing the library entry directly
 * skips that wrapper. The fallback covers 2.x, where the subpath is not exported.
 */
async function loadPdfParse() {
  try {
    return (await import('pdf-parse/lib/pdf-parse.js')).default;
  } catch {
    return (await import('pdf-parse')).default;
  }
}

/**
 * Text extraction. `pdf-parse` and `mammoth` are imported lazily because they are
 * heavy and most requests never touch them — on a serverless cold start that
 * difference is measurable.
 */
export async function extractText(buffer, mimeType, filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const pdfParse = await loadPdfParse();
    const { text } = await pdfParse(buffer);
    return text;
  }

  if (ext === 'docx' || mimeType?.includes('officedocument.wordprocessingml')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (ext === 'txt' || ext === 'md' || mimeType?.startsWith('text/')) {
    return buffer.toString('utf8');
  }

  throw Object.assign(new Error('Upload a PDF, DOCX, TXT or MD file.'), { status: 415 });
}

/** Collapse the whitespace soup that PDF extraction produces before it hits the model. */
export function cleanText(raw = '') {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\w)-\n(\w)/g, '$1$2') // rejoin hyphenated line breaks
    .trim();
}

export async function parseResume(text, provider) {
  const structured = await complete({
    provider,
    system: RESUME_SYSTEM,
    user: text.slice(0, 24000),
    json: true,
    temperature: 0.1,
    maxTokens: 4096,
  });

  // Never let the model's shape leak straight into the DB — pick only what we model.
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k]).map((k) => [k, o[k]]));
  return {
    identity: pick(structured.identity, ['firstName', 'lastName', 'fullName', 'email', 'phone', 'pronouns']),
    location: pick(structured.location, ['city', 'state', 'country', 'postalCode', 'addressLine1']),
    links: pick(structured.links, ['linkedin', 'github', 'portfolio', 'website']),
    professional: {
      ...pick(structured.professional, ['currentCompany', 'currentTitle', 'yearsExperience', 'highestEducation']),
      ...(structured.summary ? { summary: structured.summary } : {}),
    },
    employment: Array.isArray(structured.employment) ? structured.employment.slice(0, 15) : [],
    education: Array.isArray(structured.education) ? structured.education.slice(0, 10) : [],
    certifications: Array.isArray(structured.certifications) ? structured.certifications.slice(0, 20) : [],
    skills: Array.isArray(structured.skills) ? structured.skills.slice(0, 40) : [],
    projects: Array.isArray(structured.projects) ? structured.projects.slice(0, 10) : [],
    languages: Array.isArray(structured.languages) ? structured.languages.slice(0, 10) : [],
  };
}
