import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, auth } from '../lib/api.js';
import { Input, Field } from '../components/ui.jsx';

/* The sign-in page states the product's whole thesis in its first line, and the
   art side is literally a form filling itself in — the thing the product does. */
const DEMO_ROWS = [
  ['First name', 'Priya'],
  ['Work authorisation', 'Authorised, no sponsorship'],
  ['Notice period', '30 days'],
  ['Why this role?', 'Four years shipping payments infra…'],
];

export default function SignIn() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      auth.token = res.token;
      auth.user = res.user;
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <section className="gate-art">
        {/* register marks, the alignment crosses printed on real carbon forms */}
        <div className="reg" style={{ top: 30, right: 34 }} />
        <div className="reg" style={{ bottom: 30, left: 34 }} />

        <div>
          <div className="key" style={{ color: '#A8B0C0', marginBottom: 18 }}>Application autofill</div>
          <h1>Fill it once.<br />Then never again.</h1>
          <p className="lede">
            Your details, résumé and written answers live in one place. The extension
            reads whatever form is in front of you and fills it.
          </p>
        </div>

        <div style={{ marginTop: 40 }}>
          {DEMO_ROWS.map(([k, v], i) => (
            <motion.div key={k} style={{ position: 'relative', paddingBottom: 11, marginBottom: 13 }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .3 + i * .28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
                <span className="key" style={{ color: '#8A92A4' }}>{k}</span>
                <motion.span style={{ fontSize: 13.5, color: '#E9EBEF', textAlign: 'right' }}
                  initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: .55 + i * .28, duration: .3 }}>
                  {v}
                </motion.span>
              </div>
              <div style={{ position: 'absolute', inset: 'auto 0 0 0', height: 1, background: 'repeating-linear-gradient(90deg,#4A5262 0 4px,transparent 4px 8px)' }} />
              {/* ballpoint ink draws in, carbon copy follows a beat behind and registers */}
              <motion.div style={{ position: 'absolute', left: 0, bottom: 0, height: 2, background: '#2B4CF2', transformOrigin: 'left', width: '100%' }}
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: .45 + i * .28, duration: .5, ease: [.2, .9, .3, 1] }} />
              <motion.div style={{ position: 'absolute', left: 0, bottom: -2, height: 2, background: '#F25C7A', transformOrigin: 'left', width: '100%', opacity: .5 }}
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: .58 + i * .28, duration: .5, ease: [.2, .9, .3, 1] }} />
            </motion.div>
          ))}
        </div>
      </section>

      <section className="gate-form">
        <div className="inner">
          <div className="key" style={{ marginBottom: 8 }}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </div>
          <h2 className="display" style={{ fontSize: 27, marginBottom: 22 }}>
            {mode === 'login' ? 'Welcome back.' : 'Start with one profile.'}
          </h2>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Name">
                <Input value={form.name} onChange={set('name')} autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set('email')} required autoComplete="username" />
            </Field>
            <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
              <Input type="password" value={form.password} onChange={set('password')} required minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </Field>

            {error && <div className="msg error" style={{ marginTop: 14 }}>{error}</div>}

            <button className="btn primary" style={{ width: '100%', marginTop: 20 }} disabled={busy}>
              {busy && <span className="spinner" />}
              {busy ? 'Working' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button className="btn quiet sm" style={{ width: '100%', marginTop: 12 }}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create an account instead' : 'I already have an account'}
          </button>
        </div>
      </section>
    </div>
  );
}
