// Local development only. In production Vercel imports api/index.js directly and
// this file is never executed.
import 'dotenv/config';
import app from './src/app.js';

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`jobfill api  →  http://localhost:${port}/api/health`);
});
