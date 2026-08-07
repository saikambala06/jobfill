import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, Cell } from 'recharts';
import { api } from '../lib/api.js';
import { PageHead, Stagger, Item, Empty, useAsync } from '../components/ui.jsx';

/* The signature element. Each headline number is a form line that inks itself in:
   ballpoint blue draws left to right, the carbon copy follows a beat behind and
   snaps into register. It runs once, on load, and nowhere else in the product. */
function TraceLine({ label, value, suffix, delay, note }) {
  return (
    <div className="trace-line">
      <div className="label">
        <span className="key">{label}</span>
        {note && <span className="tiny muted">{note}</span>}
      </div>
      <motion.div className="val"
        initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
        transition={{ delay: delay + .18, duration: .34, ease: [.2, .9, .3, 1] }}>
        {value}{suffix && <span style={{ fontSize: 15, fontWeight: 500, marginLeft: 4, letterSpacing: 0 }}>{suffix}</span>}
      </motion.div>
      <div className="rule-base" />
      <motion.div className="rule-ink" style={{ width: '100%' }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay, duration: .55, ease: [.2, .9, .3, 1] }} />
      <motion.div className="rule-copy" style={{ width: '100%' }}
        initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay: delay + .13, duration: .55, ease: [.2, .9, .3, 1] }} />
    </div>
  );
}

export default function Overview() {
  const [{ data: stats, loading }] = useAsync(() => api.stats());
  const [{ data: profileRes }] = useAsync(() => api.profile());
  const profile = profileRes?.profile;

  if (loading) return <PageHead eyebrow="Overview" title="Loading…" />;

  const empty = !stats?.totalApplications;
  const hours = Math.floor((stats?.minutesSaved || 0) / 60);
  const mins = (stats?.minutesSaved || 0) % 60;

  return (
    <>
      <PageHead eyebrow="Overview" title="Your filing so far"
        action={<Link className="btn primary" to="/profile">Edit your details</Link>}>
        Every field the extension filled is a field you did not retype.
      </PageHead>

      {empty ? (
        <div className="panel inked">
          <Empty mark="00" title="Nothing filed yet"
            action={<Link className="btn primary" to="/profile">Fill in your details</Link>}>
            Add your details and upload a résumé, then open any job application and press
            the extension. What it fills will show up here.
          </Empty>
        </div>
      ) : (
        <Stagger className="grid c2" style={{ alignItems: 'start' }}>
          <Item>
            <div className="trace-block">
              <TraceLine label="Applications filled" value={stats.totalApplications} delay={.05} />
              <TraceLine label="Fields completed" value={stats.fieldsFilled} delay={.18}
                note={`of ${stats.fieldsDetected} detected`} />
              <TraceLine label="Typing avoided" delay={.31}
                value={hours ? `${hours}h ${mins}m` : `${mins}m`} />
              <TraceLine label="Answers on file" value={stats.savedAnswers} delay={.44}
                note="reused automatically" />
            </div>
          </Item>

          <Item>
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <span className="key">Last 30 days</span>
                <span className="tiny muted">{stats.daily?.reduce((s, d) => s + d.count, 0) || 0} filled</span>
              </div>
              <div className="panel-body" style={{ height: 158 }}>
                {stats.daily?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fontFamily: 'IBM Plex Mono', fill: '#6C7488' }}
                        tickFormatter={(d) => d.slice(8)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <Tooltip cursor={{ fill: 'rgba(43,76,242,.06)' }}
                        contentStyle={{ border: '1px solid #14161C', borderRadius: 3, fontSize: 12, fontFamily: 'Public Sans' }} />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                        {stats.daily.map((_, i) => <Cell key={i} fill={i === stats.daily.length - 1 ? '#F25C7A' : '#2B4CF2'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="tiny muted">No fills in the last 30 days.</p>}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head"><span className="key">Where you applied</span></div>
              <div className="panel-body">
                {stats.byAts?.length ? stats.byAts.map((a) => (
                  <div key={a.ats} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <span style={{ flex: 1, fontSize: 13, textTransform: 'capitalize' }}>{a.ats}</span>
                    <div style={{ flex: 2, height: 3, background: '#DDE2EA', borderRadius: 2, overflow: 'hidden' }}>
                      <motion.div style={{ height: '100%', background: '#2B4CF2' }}
                        initial={{ width: 0 }} animate={{ width: `${(a.count / stats.byAts[0].count) * 100}%` }}
                        transition={{ duration: .5, ease: [.2, .9, .3, 1] }} />
                    </div>
                    <span className="key" style={{ width: 22, textAlign: 'right' }}>{a.count}</span>
                  </div>
                )) : <p className="tiny muted">No platforms recorded yet.</p>}
              </div>
            </div>
          </Item>
        </Stagger>
      )}

      {/* Completeness is framed as what it unlocks, not as a score to chase. */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <span className="key">Profile coverage</span>
          <span className="num" style={{ fontSize: 17 }}>{profile?.completeness ?? 0}%</span>
        </div>
        <div className="panel-body">
          <div style={{ height: 3, background: '#C8CEDA', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
            <motion.div style={{ height: '100%', background: '#2B4CF2' }}
              initial={{ width: 0 }} animate={{ width: `${profile?.completeness ?? 0}%` }}
              transition={{ duration: .7, ease: [.2, .9, .3, 1] }} />
          </div>
          <div className="grid c4">
            {[
              ['Contact details', profile?.identity?.phone && profile?.identity?.email],
              ['Work authorisation', profile?.eligibility?.workAuthorized],
              ['Work history', profile?.employment?.length],
              ['Expected salary', profile?.compensation?.expectedSalary],
            ].map(([label, done]) => (
              <div key={label} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <span className={`tag ${done ? 'green' : 'grey'}`}>{done ? '✓' : '—'}</span>
                <span className="tiny">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
