import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { auth, api } from './lib/api.js';
import SignIn from './pages/SignIn.jsx';
import Overview from './pages/Overview.jsx';
import Profile from './pages/Profile.jsx';
import Documents from './pages/Documents.jsx';
import Answers from './pages/Answers.jsx';
import Applications from './pages/Applications.jsx';
import Settings from './pages/Settings.jsx';

/* Nav is numbered because a profile really is filled section by section, the way
   a paper application is. The number is the section index, not ornament. */
const NAV = [
  { to: '/', idx: '01', label: 'Overview', end: true },
  { to: '/profile', idx: '02', label: 'Your details' },
  { to: '/documents', idx: '03', label: 'Documents' },
  { to: '/answers', idx: '04', label: 'Saved answers', countKey: 'savedAnswers' },
  { to: '/applications', idx: '05', label: 'Applications', countKey: 'totalApplications' },
  { to: '/settings', idx: '06', label: 'Settings' },
];

function Shell({ children }) {
  const [user, setUser] = useState(auth.user);
  const [counts, setCounts] = useState({});
  const location = useLocation();

  useEffect(() => {
    api.me().then(({ user }) => { auth.user = user; setUser(user); }).catch(() => {});
    api.stats().then(setCounts).catch(() => {});
  }, []);

  const signOut = () => { auth.token = null; auth.user = null; location.href = '/sign-in'; };

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-mark">
          <span className="stamp">JF</span>
          <b>JobFill</b>
        </div>

        <nav className="rail-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `rail-link${isActive ? ' on' : ''}`}>
              <span className="idx">{n.idx}</span>
              <span>{n.label}</span>
              {n.countKey && counts[n.countKey] > 0 && <span className="badge">{counts[n.countKey]}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="who">
            <b>{user?.name || 'Your account'}</b>
            <span>{user?.email}</span>
          </div>
          <button className="btn quiet sm" style={{ marginTop: 12, width: '100%' }} onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: .2, ease: [.2, .9, .3, 1] }}>
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

const Guard = ({ children }) => (auth.token ? <Shell>{children}</Shell> : <Navigate to="/sign-in" replace />);

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={auth.token ? <Navigate to="/" replace /> : <SignIn />} />
      <Route path="/" element={<Guard><Overview /></Guard>} />
      <Route path="/profile" element={<Guard><Profile /></Guard>} />
      <Route path="/documents" element={<Guard><Documents /></Guard>} />
      <Route path="/answers" element={<Guard><Answers /></Guard>} />
      <Route path="/applications" element={<Guard><Applications /></Guard>} />
      <Route path="/settings" element={<Guard><Settings /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
