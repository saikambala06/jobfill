import { useState, useEffect } from 'react';
import { api, auth } from '../lib/api.js';
import { PageHead, Field, Input, Flash, useAsync } from '../components/ui.jsx';

export default function Settings() {
  const [{ data }] = useAsync(() => api.me());
  const [flash, setFlash] = useState(null);

  return (
    <>
      <PageHead eyebrow="Section 06" title="Settings">
        Your account, and how the extension behaves while it fills.
      </PageHead>

      <Flash msg={flash} onDone={() => setFlash(null)} />

      <AccountName user={data?.user} onFlash={setFlash} />
      <ChangePassword onFlash={setFlash} />
      <FillBehaviour user={data?.user} onFlash={setFlash} />
    </>
  );
}

/* ------------------------------------------------------------------ name -- */
function AccountName({ user, onFlash }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user?.name !== undefined) setName(user.name || ''); }, [user]);

  const dirty = user && name.trim() !== (user.name || '');

  async function save() {
    setBusy(true);
    try {
      const res = await api.updateSettings({ name: name.trim() });
      auth.user = res.user;
      onFlash({ kind: 'ok', text: 'Name updated.' });
    } catch (err) {
      onFlash({ kind: 'error', text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <Card n="01" title="Your name" blurb="Shown in the extension and on anything it drafts for you.">
      <Field label="Name">
        <Input value={name} onChange={setName} placeholder="Vinitha N" />
      </Field>
      <Field label="Email" hint="Sign-in address. Get in touch if you need this changed.">
        <Input value={user?.email || ''} onChange={() => {}} disabled />
      </Field>
      <Actions>
        <button className="btn primary" onClick={save} disabled={!dirty || busy}>
          {busy && <span className="spinner" />}{busy ? 'Saving' : 'Save name'}
        </button>
      </Actions>
    </Card>
  );
}

/* -------------------------------------------------------------- password -- */
function ChangePassword({ onFlash }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);

  // Say what is wrong while they type, not after they submit.
  const problem = !next ? null
    : next.length < 8 ? 'Use at least 8 characters.'
      : (again && next !== again) ? 'The two new passwords do not match.'
        : null;
  const ready = current && next.length >= 8 && next === again && !busy;

  async function save() {
    setBusy(true);
    try {
      const res = await api.changePassword({ currentPassword: current, newPassword: next });
      // The server bumps the token version, which signs out every other device —
      // so the token we are holding has to be replaced or this tab logs itself out.
      if (res.token) auth.token = res.token;
      setCurrent(''); setNext(''); setAgain('');
      onFlash({ kind: 'ok', text: 'Password changed. Every other device has been signed out.' });
    } catch (err) {
      onFlash({ kind: 'error', text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <Card n="02" title="Password" blurb="Changing this signs you out everywhere else.">
      <Field label="Current password">
        <Input type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" value={next} onChange={setNext} autoComplete="new-password" />
      </Field>
      <Field label="New password again">
        <Input type="password" value={again} onChange={setAgain} autoComplete="new-password" />
      </Field>
      {problem && <p className="tiny" style={{ color: '#F25C7A', marginTop: 8 }}>{problem}</p>}
      <Actions>
        <button className="btn primary" onClick={save} disabled={!ready}>
          {busy && <span className="spinner" />}{busy ? 'Changing' : 'Change password'}
        </button>
      </Actions>
    </Card>
  );
}

/* ------------------------------------------------------------- behaviour -- */
const TOGGLES = [
  { key: 'confirmBeforeSubmit', label: 'Never submit an application for me',
    hint: 'Fills the form and stops. You press submit.' },
  { key: 'generateMissingAnswers', label: 'Write answers I have not saved',
    hint: 'Open questions get a draft in your voice, flagged for you to check.' },
  { key: 'fillEEO', label: 'Fill voluntary disclosure questions',
    hint: 'Gender, ethnicity, veteran and disability status. Off by default, never inferred.' },
];

function FillBehaviour({ user, onFlash }) {
  const [settings, setSettings] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user?.settings) setSettings(user.settings); }, [user]);

  async function toggle(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
    setBusy(true);
    try {
      const res = await api.updateSettings({ [key]: value });
      auth.user = res.user;
    } catch (err) {
      setSettings((s) => ({ ...s, [key]: !value }));   // put it back
      onFlash({ kind: 'error', text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <Card n="03" title="How the extension fills" blurb="Saved as you change them.">
      {TOGGLES.map((t) => (
        <label key={t.key} className="setting-row"
          style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 0', borderBottom: '1px dotted #DDE2EA', cursor: 'pointer' }}>
          <input type="checkbox" style={{ marginTop: 3, accentColor: '#2B4CF2' }}
            checked={Boolean(settings[t.key])} disabled={busy}
            onChange={(e) => toggle(t.key, e.target.checked)} />
          <span>
            <strong style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{t.label}</strong>
            <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>{t.hint}</span>
          </span>
        </label>
      ))}
    </Card>
  );
}

/* ----------------------------------------------------------------- shell -- */
function Card({ n, title, blurb, children }) {
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-head" style={{ borderBottom: '1px solid #DDE2EA' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <span className="key">{n}</span>
          <div>
            <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</strong>
            {blurb && <p className="tiny muted" style={{ marginTop: 2 }}>{blurb}</p>}
          </div>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

const Actions = ({ children }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>{children}</div>
);
