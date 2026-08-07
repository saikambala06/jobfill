import jwt from 'jsonwebtoken';
import { User } from './models.js';
import { connectDB } from './db.js';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    // A missing secret is a deployment state, not a leak — say so plainly rather
    // than hiding it behind the generic 500, which sends operators hunting.
    throw Object.assign(
      new Error('Server is missing JWT_SECRET. Add it in Vercel → Settings → Environment Variables, then redeploy.'),
      { status: 503, expose: true },
    );
  }
  return s;
};

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), email: user.email, v: user.tokenVersion },
    SECRET(),
    { expiresIn: process.env.JWT_TTL || '30d' },
  );
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });

    const payload = jwt.verify(token, SECRET());
    await connectDB();
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'This account no longer exists.' });
    if (user.tokenVersion !== payload.v) {
      return res.status(401).json({ error: 'This session ended. Sign in again.' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'This session expired. Sign in again.' });
  }
}

/** Ensures the DB is up before any handler that touches it. */
export async function withDB(req, res, next) {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('[db]', err.message);
    res.status(503).json({
      error: !process.env.MONGODB_URI
        ? 'Server is missing MONGODB_URI. Add it in Vercel → Settings → Environment Variables, then redeploy.'
        : 'Cannot reach the database. Check that Atlas Network Access allows 0.0.0.0/0 and that the URI password is correct.',
    });
  }
}

/**
 * In-memory throttle. Good enough per-container on Vercel to blunt runaway
 * extension loops; swap for Upstash Redis when running more than a few instances.
 */
const buckets = new Map();
export function rateLimit({ windowMs = 60_000, max = 30, key = (req) => req.user?._id || req.ip } = {}) {
  return (req, res, next) => {
    const k = String(key(req));
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || now > b.reset) {
      buckets.set(k, { count: 1, reset: now + windowMs });
      return next();
    }
    if (b.count >= max) {
      res.set('Retry-After', Math.ceil((b.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Wait a moment and retry.' });
    }
    b.count++;
    next();
  };
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[api]', err);

  const body = {
    // Internal failures stay generic, but errors that explicitly opt in — misconfiguration,
    // not bugs — send their real message so the operator can act on it.
    error: err.expose || status < 500 ? err.message : 'Something broke on our end. Try again.',
  };

  // Set DEBUG_ERRORS=1 in the environment to have real 500s report their cause in the
  // response body. Intended for diagnosing a fresh deployment when reading function
  // logs is awkward. Remove it once the deployment is healthy.
  if (status >= 500 && process.env.DEBUG_ERRORS === '1') {
    body.debug = { name: err.name, message: String(err.message).slice(0, 300) };
  }

  res.status(status).json(body);
}

/** Wraps async handlers so a rejected promise reaches errorHandler instead of hanging. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
