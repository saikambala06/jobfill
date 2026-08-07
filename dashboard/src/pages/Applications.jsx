import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { PageHead, Empty, Select } from '../components/ui.jsx';

const STATUSES = ['filled', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn'];
const TONE = {
  filled: 'grey', submitted: 'blue', interviewing: 'blue',
  offer: 'green', rejected: 'pink', withdrawn: 'grey',
};

export default function Applications() {
  const [apps, setApps] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.applications().then((d) => setApps(d.applications)).finally(() => setLoading(false));
  }, []);

  async function setStatus(id, status) {
    await api.patchApplication(id, { status });
    setApps((a) => a.map((x) => (x._id === id ? { ...x, status } : x)));
  }

  const shown = filter ? apps.filter((a) => a.status === filter) : apps;

  return (
    <>
      <PageHead eyebrow="Section 05" title="Applications">
        Every form the extension filled, in order. Update the status as you hear back.
      </PageHead>

      <div style={{ maxWidth: 220, marginBottom: 16 }}>
        <Select value={filter} onChange={setFilter} options={STATUSES} placeholder="All statuses" />
      </div>

      <div className="panel">
        {loading ? <div className="panel-body tiny muted">Loading…</div>
          : !shown.length ? (
            <Empty mark="05" title={filter ? 'Nothing at that status' : 'No applications yet'}>
              {filter ? 'Change the filter to see the rest.'
                : 'Open a job application, press the extension, and it will show up here.'}
            </Empty>
          ) : (
            <AnimatePresence initial={false}>
              {shown.map((a) => (
                <motion.div key={a._id} className="list-row" layout
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <div className="grow">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14, textTransform: 'capitalize' }}>{a.company || 'Unknown company'}</strong>
                      <span className={`tag ${TONE[a.status]}`}>{a.status}</span>
                    </div>
                    <p className="tiny muted truncate" style={{ marginTop: 2 }}>{a.role || '—'}</p>
                    <p className="tiny muted" style={{ marginTop: 4, fontFamily: 'IBM Plex Mono', fontSize: 10.5 }}>
                      {a.fieldsFilled}/{a.fieldsDetected} fields
                      {a.ats ? ` · ${a.ats}` : ''}
                      {' · '}{new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ minWidth: 150 }}>
                    <Select value={a.status} onChange={(v) => setStatus(a._id, v)} options={STATUSES} placeholder="Set status" />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
      </div>
    </>
  );
}
