import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { PageHead, Empty, Flash, Input, Select, Field, Textarea, useAsync } from '../components/ui.jsx';

const KINDS = [
  { value: 'resume', label: 'Résumé' },
  { value: 'coverLetter', label: 'Cover letter' },
  { value: 'transcript', label: 'Transcript' },
  { value: 'portfolio', label: 'Portfolio' },
];

export default function Documents() {
  const [{ data, loading }, setState] = useAsync(() => api.resumes());
  const [flash, setFlash] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  const resumes = data?.resumes || [];
  const refresh = async () => setState({ loading: false, data: await api.resumes(), error: null });

  async function upload(file, kind = 'resume') {
    if (!file) return;
    setUploading(true);
    setFlash(null);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    try {
      const res = await api.uploadResume(form);
      setFlash({
        kind: 'ok',
        text: res.parsed
          ? 'Résumé read. Your work history, education and skills are now in your profile.'
          : res.message,
      });
      await refresh();
    } catch (err) {
      setFlash({ kind: 'error', text: err.message });
    } finally { setUploading(false); }
  }

  return (
    <>
      <PageHead eyebrow="Section 03" title="Documents">
        Upload a résumé and it fills in your profile automatically. Whatever you already
        typed stays as you wrote it.
      </PageHead>

      <Flash msg={flash} onDone={() => setFlash(null)} />

      {/* Drop zone. Reads as a blank form field waiting to be filled. */}
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        animate={{ borderColor: drag ? '#2B4CF2' : '#C8CEDA', backgroundColor: drag ? 'rgba(43,76,242,.04)' : '#fff' }}
        style={{
          border: '1px dashed', borderRadius: 3, padding: '30px 20px', textAlign: 'center',
          cursor: 'pointer', marginBottom: 20,
        }}>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden
          onChange={(e) => upload(e.target.files[0])} />
        {uploading ? (
          <div style={{ display: 'flex', gap: 9, justifyContent: 'center', alignItems: 'center' }}>
            <span className="spinner" style={{ color: '#2B4CF2' }} />
            <span className="tiny">Reading your résumé…</span>
          </div>
        ) : (
          <>
            <div className="display" style={{ fontSize: 17, marginBottom: 5 }}>Drop a résumé here</div>
            <p className="tiny muted">PDF, DOCX, TXT or MD — up to 4 MB</p>
          </>
        )}
      </motion.div>

      <div className="panel">
        <div className="panel-head">
          <span className="key">On file</span>
          <span className="tiny muted">{resumes.length} document{resumes.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? <div className="panel-body tiny muted">Loading…</div>
          : !resumes.length ? (
            <Empty mark="03" title="No documents yet">
              Upload your résumé so the extension can attach it and read your history.
            </Empty>
          ) : (
            <AnimatePresence initial={false}>
              {resumes.map((r) => (
                <motion.div key={r._id} className="list-row" layout
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <span className="tag grey" style={{ marginTop: 2 }}>
                    {(r.filename?.split('.').pop() || 'file').toUpperCase()}
                  </span>
                  <div className="grow">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{r.label}</strong>
                      {r.isDefault && <span className="tag blue">Default</span>}
                      {r.parsedAt && <span className="tag green">Read</span>}
                    </div>
                    <p className="tiny muted truncate">
                      {r.filename} · {(r.size / 1024).toFixed(0)} KB · {KINDS.find((k) => k.value === r.kind)?.label || r.kind}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!r.isDefault && (
                      <button className="btn quiet sm" onClick={async () => {
                        await api.patchResume(r._id, { isDefault: true });
                        await refresh();
                      }}>Use by default</button>
                    )}
                    <button className="btn danger sm" onClick={async () => {
                      await api.deleteResume(r._id);
                      await refresh();
                      setFlash({ kind: 'ok', text: 'Document removed.' });
                    }}>Delete</button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
      </div>

      <CoverLetter onFlash={setFlash} />
    </>
  );
}

/* Cover letters are generated per role, so they live next to the documents rather
   than in the profile. */
function CoverLetter({ onFlash }) {
  const [form, setForm] = useState({ company: '', role: '', jobDescription: '' });
  const [letter, setLetter] = useState('');
  const [busy, setBusy] = useState(false);

  async function write() {
    setBusy(true);
    try {
      const res = await api.coverLetter(form);
      setLetter(res.letter);
    } catch (err) {
      onFlash({ kind: 'error', text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="panel-head">
        <span className="key">Write a cover letter</span>
        <span className="tiny muted">Uses your default résumé</span>
      </div>
      <div className="panel-body">
        <div className="grid c2" style={{ marginBottom: 12 }}>
          <Input value={form.company} onChange={(v) => setForm({ ...form, company: v })} placeholder="Company" />
          <Input value={form.role} onChange={(v) => setForm({ ...form, role: v })} placeholder="Role" />
        </div>
        <Textarea value={form.jobDescription} rows={3}
          onChange={(v) => setForm({ ...form, jobDescription: v })}
          placeholder="Paste the job description — the letter gets sharper with it" />

        <button className="btn primary" style={{ marginTop: 12 }} onClick={write} disabled={busy || !form.company}>
          {busy && <span className="spinner" />}{busy ? 'Writing' : 'Write the letter'}
        </button>

        {letter && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 16 }}>
            <Textarea value={letter} onChange={setLetter} rows={12} />
            <button className="btn quiet sm" style={{ marginTop: 9 }}
              onClick={() => { navigator.clipboard.writeText(letter); onFlash({ kind: 'ok', text: 'Letter copied.' }); }}>
              Copy to clipboard
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
