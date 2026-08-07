import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';
import { PageHead, Empty, Flash, Input, Textarea } from '../components/ui.jsx';

/* The answer library. The count of how many times a question has come up is the
   whole point of this page — it turns "I keep retyping this" into a fact. */
export default function Answers() {
  const [answers, setAnswers] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (query) => {
    setLoading(true);
    try { setAnswers((await api.answers(query)).answers); }
    catch (err) { setFlash({ kind: 'error', text: err.message }); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q || undefined), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function save(id) {
    try {
      await api.patchAnswer(id, { answer: draft });
      setAnswers((a) => a.map((x) => (x._id === id ? { ...x, answer: draft } : x)));
      setEditing(null);
      setFlash({ kind: 'ok', text: 'Answer updated. It will fill this way from now on.' });
    } catch (err) { setFlash({ kind: 'error', text: err.message }); }
  }

  const repeated = answers.filter((a) => a.timesUsed > 1);

  return (
    <>
      <PageHead eyebrow="Section 04" title="Saved answers">
        Every answer you write on a form gets kept here. When the same question turns up
        again — however it is worded — it fills itself.
      </PageHead>

      <Flash msg={flash} onDone={() => setFlash(null)} />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Input value={q} onChange={setQ} placeholder="Search your answers" />
        </div>
        {repeated.length > 0 && (
          <span className="tag pink">{repeated.length} asked more than once</span>
        )}
      </div>

      <div className="panel">
        {loading ? <div className="panel-body tiny muted">Loading…</div>
          : !answers.length ? (
            <Empty mark="04" title={q ? 'No answers match that' : 'No answers saved yet'}>
              {q ? 'Try a different word from the question.'
                : 'Fill an application with the extension, then press "Save answers". What you wrote lands here.'}
            </Empty>
          ) : (
            <AnimatePresence initial={false}>
              {answers.map((a) => (
                <motion.div key={a._id} className="list-row" layout
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <div className="grow">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 5 }}>
                      <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{a.question}</strong>
                      {a.timesUsed > 1 && <span className="tag pink">asked {a.timesUsed}×</span>}
                      {a.source === 'ai' && <span className="tag blue">written by AI</span>}
                    </div>

                    {editing === a._id ? (
                      <>
                        <Textarea value={draft} onChange={setDraft} rows={5} />
                        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                          <button className="btn primary sm" onClick={() => save(a._id)}>Save answer</button>
                          <button className="btn quiet sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <p className="tiny" style={{ color: '#4A5262', whiteSpace: 'pre-wrap' }}>{a.answer}</p>
                    )}

                    {a.sites?.length > 0 && editing !== a._id && (
                      <p className="tiny muted" style={{ marginTop: 6, fontFamily: 'IBM Plex Mono', fontSize: 10.5 }}>
                        {a.sites.slice(0, 3).join(' · ')}{a.sites.length > 3 ? ` +${a.sites.length - 3}` : ''}
                      </p>
                    )}
                  </div>

                  {editing !== a._id && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn quiet sm" onClick={() => { setEditing(a._id); setDraft(a.answer); }}>Edit</button>
                      <button className="btn danger sm" onClick={async () => {
                        await api.deleteAnswer(a._id);
                        setAnswers((x) => x.filter((y) => y._id !== a._id));
                      }}>Delete</button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
      </div>
    </>
  );
}
