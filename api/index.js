// Vercel serverless entry for the whole API.
//
// One function handles every /api/* route rather than a file per endpoint: that
// means one cold start and one Mongo connection pool per container instead of a
// dozen competing ones.
import app from '../server/src/app.js';
export default app;
