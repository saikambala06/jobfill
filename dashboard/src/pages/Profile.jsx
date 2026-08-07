import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { PageHead, Field, Input, Select, Textarea, Flash, useAsync } from '../components/ui.jsx';

const YES_NO = ['Yes', 'No'];
const REMOTE = ['Remote', 'Hybrid', 'On-site', 'No preference'];
const RELOCATE = ['Yes', 'No', 'For the right role'];
const TRAVEL = ['None', 'Up to 25%', 'Up to 50%', 'Up to 75%', 'As needed'];
const NOTICE = ['Immediately', '2 weeks', '30 days', '60 days', '90 days'];
const GENDER = ['Male', 'Female', 'Non-binary', 'I prefer not to say'];
const VETERAN = ['I am not a protected veteran', 'I identify as a protected veteran', 'I prefer not to say'];
const DISABILITY = ['No, I do not have a disability', 'Yes, I have a disability', 'I prefer not to answer'];
const ETHNICITY = ['Asian', 'Black or African American', 'Hispanic or Latino', 'Native American or Alaska Native',
  'Native Hawaiian or Pacific Islander', 'White', 'Two or more races', 'I prefer not to say'];

/* Sections mirror the order a real application asks for things, which is also the
   order the numbered nav promises. */
const SECTIONS = [
  { id: 'identity', n: '01', title: 'Who you are', blurb: 'The fields every form opens with.' },
  { id: 'location', n: '02', title: 'Where you are', blurb: 'Used for address, city and country selectors.' },
  { id: 'links', n: '03', title: 'Your links' },
  { id: 'professional', n: '04', title: 'Current work' },
  { id: 'compensation', n: '05', title: 'Pay and availability', blurb: 'Always flagged for you to check before submitting.' },
  { id: 'preferences', n: '06', title: 'How you want to work' },
  { id: 'eligibility', n: '07', title: 'Work authorisation', blurb: 'The questions that decide whether an application goes forward.' },
  { id: 'history', n: '08', title: 'Experience and education' },
  { id: 'demographics', n: '09', title: 'Voluntary disclosure', blurb: 'Only filled if you switch it on in the extension. Never inferred.' },
];

export default function Profile() {
  const [{ data, loading }] = useAsync(() => api.profile());
  const [p, setP] = useState(null);
  const [flash, setFlash] = useState(null);
  const [saving, setSaving] = useState(false);
  // A set, not a single id. This is the page you fill in once, and an accordion
  // that closes what you just did to open the next thing makes it impossible to
  // check your own work — you cannot see whether a section has anything in it
  // without opening it and losing your place in the one before.
  const [open, setOpen] = useState(() => new Set(['identity']));
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => { if (data?.profile) setP(data.profile); }, [data]);

  const set = (group, key) => (v) => setP((prev) => ({ ...prev, [group]: { ...prev[group], [key]: v } }));

  async function save() {
    setSaving(true);
    try {
      const { profile } = await api.saveProfile(p);
      setP(profile);
      setFlash({ kind: 'ok', text: `Details saved. Profile coverage is now ${profile.completeness}%.` });
    } catch (err) {
      setFlash({ kind: 'error', text: err.message });
    } finally { setSaving(false); }
  }

  if (loading || !p) return <PageHead eyebrow="Section 02" title="Loading…" />;

  return (
    <>
      <PageHead eyebrow="Section 02" title="Your details"
        action={<button className="btn primary" onClick={save} disabled={saving}>
          {saving && <span className="spinner" />}{saving ? 'Saving' : 'Save changes'}
        </button>}>
        Fill this in once. The extension reads from here on every application.
      </PageHead>

      <Flash msg={flash} onDone={() => setFlash(null)} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="btn ghost small"
          onClick={() => setOpen(open.size === SECTIONS.length ? new Set() : new Set(SECTIONS.map((s) => s.id)))}>
          {open.size === SECTIONS.length ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {SECTIONS.map((s) => (
        <Section key={s.id} s={s} open={open.has(s.id)} filled={countFilled(p, s.id)}
          onToggle={() => toggle(s.id)}>
          {s.id === 'identity' && (<>
            <Field label="First name"><Input value={p.identity?.firstName} onChange={set('identity', 'firstName')} /></Field>
            <Field label="Last name"><Input value={p.identity?.lastName} onChange={set('identity', 'lastName')} /></Field>
            <Field label="Preferred name" hint="Used when a form asks what you go by."><Input value={p.identity?.preferredName} onChange={set('identity', 'preferredName')} /></Field>
            <Field label="Email"><Input type="email" value={p.identity?.email} onChange={set('identity', 'email')} /></Field>
            <Field label="Phone"><Input type="tel" value={p.identity?.phone} onChange={set('identity', 'phone')} placeholder="+91 98765 43210" /></Field>
            <Field label="Country phone code" hint="Forms with a separate dial-code picker use this."><Input value={p.identity?.phoneCountryCode} onChange={set('identity', 'phoneCountryCode')} placeholder="+91" /></Field>
            <Field label="Phone type" hint="Left blank, a form that asks will stay blank rather than guess.">
              <Select value={p.identity?.phoneDeviceType} onChange={set('identity', 'phoneDeviceType')}
                placeholder="Not set" options={['Mobile', 'Home', 'Work', 'Landline']} />
            </Field>
            <Field label="Pronouns"><Input value={p.identity?.pronouns} onChange={set('identity', 'pronouns')} placeholder="she/her" /></Field>
          </>)}

          {s.id === 'location' && (<>
            <Field label="Street address"><Input value={p.location?.addressLine1} onChange={set('location', 'addressLine1')} /></Field>
            <Field label="Apartment, suite"><Input value={p.location?.addressLine2} onChange={set('location', 'addressLine2')} /></Field>
            <Field label="City"><Input value={p.location?.city} onChange={set('location', 'city')} /></Field>
            <Field label="State or province"><Input value={p.location?.state} onChange={set('location', 'state')} /></Field>
            <Field label="Country"><Input value={p.location?.country} onChange={set('location', 'country')} /></Field>
            <Field label="Postal code"><Input value={p.location?.postalCode} onChange={set('location', 'postalCode')} /></Field>
          </>)}

          {s.id === 'links' && ['linkedin', 'github', 'portfolio', 'website'].map((k) => (
            <Field key={k} label={k === 'linkedin' ? 'LinkedIn' : k === 'github' ? 'GitHub' : k}>
              <Input type="url" value={p.links?.[k]} onChange={set('links', k)} placeholder="https://" />
            </Field>
          ))}

          {s.id === 'professional' && (<>
            <Field label="Current title"><Input value={p.professional?.currentTitle} onChange={set('professional', 'currentTitle')} /></Field>
            <Field label="Current company"><Input value={p.professional?.currentCompany} onChange={set('professional', 'currentCompany')} /></Field>
            <Field label="Years of experience"><Input type="number" min="0" max="60" value={p.professional?.yearsExperience} onChange={(v) => set('professional', 'yearsExperience')(Number(v))} /></Field>
            <Field label="Highest education"><Input value={p.professional?.highestEducation} onChange={set('professional', 'highestEducation')} placeholder="Bachelor's degree" /></Field>
            <Field label="Summary" hint="Used when a form asks you to describe yourself. Keep it in your own voice.">
              <Textarea value={p.professional?.summary} onChange={set('professional', 'summary')} rows={4} />
            </Field>
          </>)}

          {s.id === 'compensation' && (<>
            <Field label="Expected salary"><Input value={p.compensation?.expectedSalary} onChange={set('compensation', 'expectedSalary')} placeholder="1,800,000" /></Field>
            <Field label="Current salary" hint="Left blank is fine — many forms allow it and some regions bar the question."><Input value={p.compensation?.currentSalary} onChange={set('compensation', 'currentSalary')} /></Field>
            <Field label="Currency"><Select value={p.compensation?.salaryCurrency} onChange={set('compensation', 'salaryCurrency')} options={['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD']} /></Field>
            <Field label="Notice period"><Select value={p.compensation?.noticePeriod} onChange={set('compensation', 'noticePeriod')} options={NOTICE} /></Field>
            <Field label="Available from"><Input type="date" value={p.compensation?.availableFrom} onChange={set('compensation', 'availableFrom')} /></Field>
          </>)}

          {s.id === 'preferences' && (<>
            <Field label="Work location"><Select value={p.preferences?.remotePreference} onChange={set('preferences', 'remotePreference')} options={REMOTE} /></Field>
            <Field label="Open to relocating"><Select value={p.preferences?.willingToRelocate} onChange={set('preferences', 'willingToRelocate')} options={RELOCATE} /></Field>
            <Field label="Willing to travel"><Select value={p.preferences?.willingToTravel} onChange={set('preferences', 'willingToTravel')} options={TRAVEL} /></Field>
            <Field label="Schedule"><Select value={p.preferences?.workSchedule} onChange={set('preferences', 'workSchedule')} options={['Full-time', 'Part-time', 'Contract', 'Internship']} /></Field>
          </>)}

          {s.id === 'eligibility' && (<>
            <Field label="Authorised to work" hint="Answered as the form asks it: are you legally allowed to work in the hiring country?">
              <Select value={p.eligibility?.workAuthorized} onChange={set('eligibility', 'workAuthorized')} options={YES_NO} />
            </Field>
            <Field label="Needs sponsorship" hint="Asked separately on almost every form, and often the opposite of the answer above.">
              <Select value={p.eligibility?.requiresSponsorship} onChange={set('eligibility', 'requiresSponsorship')} options={YES_NO} />
            </Field>
            <Field label="Visa status"><Input value={p.eligibility?.visaStatus} onChange={set('eligibility', 'visaStatus')} placeholder="Citizen, H-1B, OPT, Skilled Worker…" /></Field>
            <Field label="Driving licence"><Select value={p.eligibility?.hasDriversLicense} onChange={set('eligibility', 'hasDriversLicense')} options={YES_NO} /></Field>
            <Field label="Over 18"><Select value={p.eligibility?.over18} onChange={set('eligibility', 'over18')} options={YES_NO} /></Field>
          </>)}

          {s.id === 'history' && <History p={p} setP={setP} />}

          {s.id === 'demographics' && (<>
            <Field label="Gender"><Select value={p.demographics?.gender} onChange={set('demographics', 'gender')} options={GENDER} /></Field>
            <Field label="Race or ethnicity"><Select value={p.demographics?.ethnicity} onChange={set('demographics', 'ethnicity')} options={ETHNICITY} /></Field>
            <Field label="Veteran status"><Select value={p.demographics?.veteranStatus} onChange={set('demographics', 'veteranStatus')} options={VETERAN} /></Field>
            <Field label="Disability status"><Select value={p.demographics?.disabilityStatus} onChange={set('demographics', 'disabilityStatus')} options={DISABILITY} /></Field>
          </>)}
        </Section>
      ))}

      <div style={{ position: 'sticky', bottom: 18, marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving && <span className="spinner" />}{saving ? 'Saving' : 'Save changes'}
        </button>
      </div>
    </>
  );
}

/**
 * How many values a section actually holds. Shown on the closed header so the
 * empty sections — the ones costing you filled fields on every application — are
 * obvious without opening all nine.
 */
function countFilled(p, id) {
  if (!p) return 0;
  if (id === 'history') return (p.employment?.length || 0) + (p.education?.length || 0);
  const group = p[id] || {};
  return Object.values(group).filter((v) => (Array.isArray(v) ? v.length : String(v ?? '').trim())).length;
}

function Section({ s, open, onToggle, filled = 0, children }) {
  return (
    <div className="panel" style={{ marginBottom: 12, borderColor: open ? '#14161C' : undefined }}>
      <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
        <div className="panel-head" style={{ borderBottom: open ? '1px solid #DDE2EA' : 'none' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <span className="key">{s.n}</span>
            <div>
              <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{s.title}</strong>
              {s.blurb && <p className="tiny muted" style={{ marginTop: 2 }}>{s.blurb}</p>}
            </div>
          </div>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="key" style={{ color: filled ? undefined : '#F25C7A' }}>
              {filled ? `${filled} filled` : 'empty'}
            </span>
            <span className="key">{open ? '–' : '+'}</span>
          </span>
        </div>
      </button>
      {open && (
        <motion.div className="panel-body"
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: .22, ease: [.2, .9, .3, 1] }} style={{ overflow: 'hidden' }}>
          {children}
        </motion.div>
      )}
    </div>
  );
}

/* Employment, education and skills — the repeating sections every ATS asks for. */
function History({ p, setP }) {
  const [skill, setSkill] = useState('');

  const addRow = (list, blank) => setP((prev) => ({ ...prev, [list]: [...(prev[list] || []), blank] }));
  const setRow = (list, i, k, v) => setP((prev) => ({
    ...prev, [list]: prev[list].map((r, j) => (j === i ? { ...r, [k]: v } : r)),
  }));
  const delRow = (list, i) => setP((prev) => ({ ...prev, [list]: prev[list].filter((_, j) => j !== i) }));

  return (
    <>
      <div className="key" style={{ marginBottom: 10 }}>Employment</div>
      {(p.employment || []).map((e, i) => (
        <div key={i} className="panel" style={{ marginBottom: 10, background: '#FAFBFC' }}>
          <div className="panel-body">
            <div className="grid c2">
              <Input value={e.title} onChange={(v) => setRow('employment', i, 'title', v)} placeholder="Job title" />
              <Input value={e.company} onChange={(v) => setRow('employment', i, 'company', v)} placeholder="Company" />
              <Input value={e.startDate} onChange={(v) => setRow('employment', i, 'startDate', v)} placeholder="Start — 2022-03" />
              <Input value={e.endDate} onChange={(v) => setRow('employment', i, 'endDate', v)} placeholder="End — leave blank if current" />
            </div>
            <Textarea style={{ marginTop: 10 }} value={e.description} rows={2}
              onChange={(v) => setRow('employment', i, 'description', v)} placeholder="What you did and what changed because of it" />
            <button className="btn danger sm" style={{ marginTop: 10 }} onClick={() => delRow('employment', i)}>Remove</button>
          </div>
        </div>
      ))}
      <button className="btn quiet sm" onClick={() => addRow('employment', { title: '', company: '' })}>Add a role</button>

      <div className="key" style={{ margin: '22px 0 10px' }}>Education</div>
      {(p.education || []).map((e, i) => (
        <div key={i} className="panel" style={{ marginBottom: 10, background: '#FAFBFC' }}>
          <div className="panel-body">
            <div className="grid c2">
              <Input value={e.institution} onChange={(v) => setRow('education', i, 'institution', v)} placeholder="Institution" />
              <Input value={e.degree} onChange={(v) => setRow('education', i, 'degree', v)} placeholder="Degree" />
              <Input value={e.fieldOfStudy} onChange={(v) => setRow('education', i, 'fieldOfStudy', v)} placeholder="Field of study" />
              <Input value={e.endDate} onChange={(v) => setRow('education', i, 'endDate', v)} placeholder="Graduated — 2021-06" />
            </div>
            <button className="btn danger sm" style={{ marginTop: 10 }} onClick={() => delRow('education', i)}>Remove</button>
          </div>
        </div>
      ))}
      <button className="btn quiet sm" onClick={() => addRow('education', { institution: '', degree: '' })}>Add a qualification</button>

      <div className="key" style={{ margin: '22px 0 10px' }}>Skills</div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {(p.skills || []).map((sk, i) => (
          <span key={sk + i} className="chip">
            {sk}
            <button onClick={() => setP((prev) => ({ ...prev, skills: prev.skills.filter((_, j) => j !== i) }))}
              aria-label={`Remove ${sk}`}>×</button>
          </span>
        ))}
      </div>
      <Input value={skill} onChange={setSkill} placeholder="Type a skill and press Enter"
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !skill.trim()) return;
          e.preventDefault();
          setP((prev) => ({ ...prev, skills: [...new Set([...(prev.skills || []), skill.trim()])] }));
          setSkill('');
        }} />
    </>
  );
}
