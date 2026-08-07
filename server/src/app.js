import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { withDB, errorHandler } from './middleware.js';
import auth from './routes/auth.js';
import profile from './routes/profile.js';
import resumes from './routes/resumes.js';
import autofill from './routes/autofill.js';
import answers from './routes/answers.js';
import applications from './routes/applications.js';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * CORS.
 *
 * Two rules that matter here:
 *
 * 1. Same-origin must be allowed explicitly. When the dashboard and API share a
 *    deployment the browser still sends an `Origin` header on POST, so a callback
 *    that only consults an allowlist rejects the app's own front end.
 * 2. Never throw. Throwing from this callback turns a CORS policy decision into a
 *    500 from the error handler. Returning `origin: false` simply omits the
 *    `Access-Control-Allow-Origin` header and lets the browser enforce the block,
 *    which is where enforcement belongs.
 */
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

function corsDelegate(req, cb) {
  const origin = req.headers.origin;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const self = req.headers.host ? `${proto}://${req.headers.host}` : null;

  const ok = !origin
    || origin === self
    || origin.startsWith('chrome-extension://')
    || origin.startsWith('moz-extension://')
    || allowed.includes(origin)
    || /^https?:\/\/localhost(:\d+)?$/.test(origin)
    || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

  cb(null, { origin: ok && origin ? origin : false, credentials: true });
}

app.use(cors(corsDelegate));

/**
 * Health + config check. Reports which required variables are present — never
 * their values. This is the first thing to curl when a deployed instance misbehaves,
 * because a missing variable otherwise surfaces as an opaque 500 deep in a handler.
 */
app.get('/api/health', (req, res) => {
  const config = {
    mongodb: Boolean(process.env.MONGODB_URI),
    jwtSecret: Boolean(process.env.JWT_SECRET),
    groq: Boolean(process.env.GROQ_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };
  // Anthropic is genuinely optional; the other three are not.
  const missing = ['mongodb', 'jwtSecret', 'groq'].filter((k) => !config[k]);

  res.status(missing.length ? 503 : 200).json({
    ok: missing.length === 0,
    service: 'jobfill-api',
    config,
    missing,
    ...(missing.length
      ? { hint: `Set ${missing.join(', ')} in Vercel → Settings → Environment Variables, then redeploy.` }
      : {}),
    time: new Date().toISOString(),
  });
});

app.use('/api', withDB);
app.use('/api/auth', auth);
app.use('/api/profile', profile);
app.use('/api/resumes', resumes);
app.use('/api/autofill', autofill);
app.use('/api/answers', answers);
app.use('/api/applications', applications);

app.use('/api', (req, res) => res.status(404).json({ error: `No endpoint at ${req.method} ${req.path}` }));
app.use(errorHandler);

export default app;
