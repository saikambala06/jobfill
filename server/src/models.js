import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;
const sub = (def) => new Schema(def, { _id: false });

/* -------------------------------------------------------------- user ---- */
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  name: { type: String, trim: true },
  plan: { type: String, enum: ['free', 'pro'], default: 'free' },
  // Rotating this invalidates every issued token — used on password change and logout-everywhere.
  tokenVersion: { type: Number, default: 0 },
  settings: {
    autofillOnOpen: { type: Boolean, default: false },
    confirmBeforeSubmit: { type: Boolean, default: true },
    generateMissingAnswers: { type: Boolean, default: true },
    fillEEO: { type: Boolean, default: false },
    aiProvider: { type: String, enum: ['groq', 'anthropic'], default: 'groq' },
  },
  usage: {
    fillsThisMonth: { type: Number, default: 0 },
    periodStart: { type: Date, default: Date.now },
  },
}, { timestamps: true });

/* ----------------------------------------------------------- profile ---- */
const EmploymentSchema = sub({
  company: String, title: String, location: String, employmentType: String,
  startDate: String, endDate: String, current: Boolean, description: String,
});
const EducationSchema = sub({
  institution: String, degree: String, fieldOfStudy: String, location: String,
  startDate: String, endDate: String, gpa: String,
});
const CertificationSchema = sub({
  name: String, issuer: String, issueDate: String, expiryDate: String, credentialId: String, url: String,
});

const ProfileSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

  identity: {
    firstName: String, lastName: String, middleName: String, fullName: String,
    preferredName: String, pronouns: String, email: String,
    phone: String, phoneCountryCode: String,
    // Workday and Oracle both ask for this next to the number, and a wrong guess
    // ("Landline" against a mobile) is visible to the recruiter. Stored, not inferred.
    phoneDeviceType: { type: String, enum: ['Mobile', 'Home', 'Work', 'Landline', ''], default: '' },
    dateOfBirth: String,
  },
  location: {
    addressLine1: String, addressLine2: String, city: String,
    state: String, country: String, postalCode: String, timezone: String,
  },
  links: {
    linkedin: String, github: String, portfolio: String, website: String,
    twitter: String, stackoverflow: String, dribbble: String, behance: String,
  },
  professional: {
    currentCompany: String, currentTitle: String, yearsExperience: Number,
    highestEducation: String, summary: String,
  },
  compensation: {
    currentSalary: String, expectedSalary: String, salaryCurrency: { type: String, default: 'USD' },
    noticePeriod: String, availableFrom: String,
  },
  preferences: {
    willingToRelocate: String, remotePreference: String, willingToTravel: String,
    workSchedule: String, preferredLocations: [String],
  },
  eligibility: {
    workAuthorized: String, requiresSponsorship: String, visaStatus: String,
    hasDriversLicense: String, criminalRecord: String, over18: String,
    countriesAuthorized: [String],
  },
  // Voluntary self-identification. Never inferred — only ever what the user typed.
  demographics: {
    gender: String, ethnicity: String, hispanicLatino: String,
    veteranStatus: String, disabilityStatus: String,
  },

  employment: [EmploymentSchema],
  education: [EducationSchema],
  certifications: [CertificationSchema],
  skills: [String],
  languages: [sub({ language: String, proficiency: String })],
  projects: [sub({ name: String, description: String, url: String })],
  references: [sub({ name: String, relationship: String, company: String, email: String, phone: String })],

  completeness: { type: Number, default: 0 },
}, { timestamps: true });

/* ------------------------------------------------------------ resume ---- */
const ResumeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  label: { type: String, default: 'Résumé' },
  filename: String,
  mimeType: String,
  size: Number,
  kind: { type: String, enum: ['resume', 'coverLetter', 'transcript', 'portfolio', 'other'], default: 'resume' },
  // Small documents live inline. Anything larger is pushed to blob storage and
  // referenced by URL — see storage.js for the swap point.
  data: Buffer,
  storageUrl: String,
  extractedText: String,
  isDefault: { type: Boolean, default: false },
  parsedAt: Date,
}, { timestamps: true });
ResumeSchema.index({ userId: 1, kind: 1, isDefault: -1 });

/* ------------------------------------------------------------ answer ---- */
const AnswerSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  question: { type: String, required: true },
  normalized: { type: String, required: true, index: true },
  // "employment:1", "education:0" — which repeating block the question was asked
  // in. Part of the identity of the answer: without it the second job's "Company"
  // overwrites the first one's, and whichever was saved last wins both.
  scope: { type: String, default: '' },
  // An empty answer the user deliberately left empty. Stored so the next fill
  // leaves it empty too, instead of the planner filling in the gap for them.
  skipped: { type: Boolean, default: false },
  answer: { type: String, default: '' },
  canonicalKey: String,
  control: String,
  chosenOptions: [String],
  source: { type: String, enum: ['user', 'ai', 'profile'], default: 'user' },
  timesUsed: { type: Number, default: 1 },
  lastUsedAt: { type: Date, default: Date.now },
  pinned: { type: Boolean, default: false },
  sites: [String],
}, { timestamps: true });
// NOTE: replaces the old { userId, normalized } unique index. On an existing
// database drop that one first: db.answers.dropIndex('userId_1_normalized_1').
AnswerSchema.index({ userId: 1, normalized: 1, scope: 1 }, { unique: true });

/* ------------------------------------------------------- application ---- */
const ApplicationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  company: String,
  role: String,
  url: String,
  ats: String,
  status: {
    type: String,
    enum: ['filled', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn'],
    default: 'filled',
  },
  fieldsDetected: Number,
  fieldsFilled: Number,
  fieldsNeedingReview: Number,
  durationMs: Number,
  resumeId: { type: Schema.Types.ObjectId, ref: 'Resume' },
  notes: String,
}, { timestamps: true });
ApplicationSchema.index({ userId: 1, createdAt: -1 });

/* Guard against model recompilation across warm serverless invocations. */
export const User = models.User || model('User', UserSchema);
export const Profile = models.Profile || model('Profile', ProfileSchema);
export const Resume = models.Resume || model('Resume', ResumeSchema);
export const Answer = models.Answer || model('Answer', AnswerSchema);
export const Application = models.Application || model('Application', ApplicationSchema);
