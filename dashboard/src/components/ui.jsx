import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

/* Shared primitives. Kept small on purpose — the design system lives in CSS,
   these only carry behaviour. */

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: .32, ease: [.2, .9, .3, 1] },
};

/** Stagger children by index without every caller wiring variants. */
export const Stagger = ({ children, gap = 0.04, ...rest }) => (
  <motion.div initial="hidden" animate="show"
    variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }} {...rest}>
    {children}
  </motion.div>
);

export const Item = ({ children, ...rest }) => (
  <motion.div
    variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
    transition={{ duration: .3, ease: [.2, .9, .3, 1] }} {...rest}>
    {children}
  </motion.div>
);

export function PageHead({ eyebrow, title, children, action }) {
  return (
    <motion.header className="page-head" {...fadeUp}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          {eyebrow && <div className="key eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
        {action}
      </div>
    </motion.header>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="frow">
      <label className="key">{label}</label>
      <div>
        {children}
        {hint && <p className="tiny muted" style={{ marginTop: 5 }}>{hint}</p>}
      </div>
    </div>
  );
}

export function Input({ value, onChange, ...rest }) {
  return (
    <input
      className={`input${value ? ' has-value' : ''}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
}

export function Select({ value, onChange, options, placeholder = 'Choose…', ...rest }) {
  return (
    <select className={`select input${value ? ' has-value' : ''}`} value={value ?? ''}
      onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{placeholder}</option>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

export function Textarea({ value, onChange, ...rest }) {
  return <textarea className="textarea input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

export function Empty({ mark, title, children, action }) {
  return (
    <motion.div className="empty" {...fadeUp}>
      <div className="mark">{mark}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </motion.div>
  );
}

/** A message that clears itself, so callers never have to schedule the timeout. */
export function Flash({ msg, onDone, ms = 4000 }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [msg, ms, onDone]);

  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          className={`msg ${msg.kind || 'ok'}`}
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: .22 }}>
          {msg.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error: error.message }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state, setState];
}
