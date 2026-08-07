# Deploying JobFill

Everything deploys as **one Vercel project**. The dashboard is served as static files and
the API runs as a single serverless function on the same domain.

```
jobfill-ai/
├── package.json        one dependency set for API + dashboard
├── vercel.json         build, output and routing
├── vite.config.js      builds dashboard/ → dist/
│
├── api/index.js        ← Vercel turns this into the serverless function
├── server/src/         the Express app the function imports
├── dashboard/          React source, built to dist/
└── extension/          not deployed — loaded into Chrome
```

Because both halves share one origin, the dashboard calls `/api/...` relatively. There is
no API base URL to configure and no CORS to set up for it.

---

## Before you start

Accounts needed: [GitHub](https://github.com), [Vercel](https://vercel.com),
[MongoDB Atlas](https://www.mongodb.com/atlas), [Groq](https://console.groq.com). All have
free tiers that cover personal use.

## 1. MongoDB Atlas

1. Create a free **M0** cluster.
2. **Database Access** → add a user, save the password.
3. **Network Access** → **Allow access from anywhere** (`0.0.0.0/0`). Vercel's function
   IPs are not fixed, so an IP allowlist will lock you out.
4. **Connect → Drivers** → copy the string, substitute the real password, add the db name:

```
mongodb+srv://user:REALPASSWORD@cluster.mongodb.net/jobfill?retryWrites=true&w=majority
```

## 2. Groq API key

[console.groq.com/keys](https://console.groq.com/keys) → Create API Key. Starts with
`gsk_`. Copy it now — Groq will not show it again.

An [Anthropic key](https://console.anthropic.com/settings/keys) is optional; it adds
failover and is used for long-form written answers.

## 3. Push to GitHub

Create an **empty** repo (no README, no .gitignore — this project has both).

```bash
cd jobfill-ai
git init
git add .
git status          # verify: no node_modules, no .env, no dist
git commit -m "JobFill: extension, API and dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/jobfill-ai.git
git push -u origin main
```

If `.env` or `node_modules` appears, stop and fix `.gitignore` first. A leaked
`JWT_SECRET` or `GROQ_API_KEY` means rotating both.

## 4. Deploy

**Add New → Project → Import** your repo. Then **accept every default** — do not set a
Root Directory and do not override the build command. `vercel.json` already specifies
everything:

| Setting | Leave as |
|---|---|
| Root Directory | `./` (repo root) |
| Framework Preset | auto-detected |
| Build Command | from `vercel.json` |
| Output Directory | from `vercel.json` |

Add environment variables under **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `MONGODB_URI` | your Atlas string |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `GROQ_API_KEY` | `gsk_…` |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `ANTHROPIC_API_KEY` | optional |

You do **not** need `ALLOWED_ORIGINS`. The dashboard shares the API's origin, and
`chrome-extension://` origins are always permitted.

Deploy, then verify both halves on the one domain:

```bash
curl https://your-app.vercel.app/api/health     # {"ok":true,"ai":{"groq":true,…}}
open  https://your-app.vercel.app               # the dashboard
```

If `groq` reads `false`, the variable did not save or you deployed before adding it —
redeploy.

## 5. Point the extension at your deployment

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → the `extension/`
folder. Then:

**Popup → Server → API address → `https://your-app.vercel.app` → Save address**

The extension is the one piece that still needs the full URL, because it runs on job-board
domains rather than yours. Skip this and it keeps calling `localhost:4000`.

---

## Running it locally

Two processes, because Vite serves the dashboard and Node runs the API:

```bash
npm install
cp .env.example .env      # fill in the values

npm run dev:api           # terminal 1 — http://localhost:4000
npm run dev               # terminal 2 — http://localhost:5173
```

Vite proxies `/api` to port 4000, so the dashboard behaves exactly as it will in
production. Alternatively `vercel dev` runs both together and mirrors the real routing.

---

## How the routing works

`vercel.json` does the whole job:

```json
"rewrites": [
  { "source": "/api/(.*)",     "destination": "/api/index.js" },
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

The first sends every API path to the one function. The second is the SPA fallback, so
`/profile` and `/answers` load the app instead of 404ing — its negative lookahead is what
keeps it from swallowing API calls. Vercel checks the filesystem before applying rewrites,
so built assets in `dist/` are served directly.

`includeFiles: "server/src/**"` guarantees the whole Express app is bundled into the
function, since `api/index.js` imports it from outside its own directory.

**One function, not one per route.** Most Vercel examples give each endpoint its own file.
Routing everything through a single Express app means one cold start and one Mongo
connection pool per container instead of a dozen competing ones — which is also why
`db.js` caches the connection *promise*, collapsing concurrent cold starts into a single
Atlas handshake.

---

## Distributing the extension

Not hosted on Vercel — it is a browser extension.

- **Personal use** — keep loading it unpacked.
- **A few colleagues** — send them the `extension/` folder.
- **Chrome Web Store** — $5 one-time fee, then run `./scripts/pack-extension.sh` to build
  `dist/jobfill-extension.zip`. That script strips the localhost host permission from a
  staged copy, leaving your source dev-usable. Expect review questions about
  `"host_permissions": ["https://*/*"]`; explain the extension only acts on user click.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| 500 with `debug: {message: "Origin not allowed"}` | Fixed — the CORS callback now allows the deployment's own origin and never throws |
| `ENOENT ./test/data/05-versions-space.pdf` on résumé upload | `pdf-parse` imported bare under ESM — fixed in `resumeParser.js`; do not "simplify" that import back |
| "Cannot reach the server" in the extension | API address not set in the popup (step 5) |
| Dashboard loads, `/profile` 404s on refresh | SPA rewrite missing — check `vercel.json` is at the repo root |
| `/api/health` returns dashboard HTML | The `/api/(.*)` rewrite is not first |
| Build fails on `vite: not found` | A Root Directory was set — clear it back to `./` |
| `MONGODB_URI is not set` in logs | Variable added but not deployed since — redeploy |
| Atlas connection timeouts | Network Access not set to `0.0.0.0/0` |
| Function timeout on AI calls | `vercel.json` sets `maxDuration: 60`; check your plan's ceiling |
| First request after idle is slow | Cold start paying the Mongo handshake — expected |

**Logs:** Vercel project → Deployments → click the deployment → **Functions**. Server
errors carry `[api]`, `[db]` or `[planner]` prefixes.

---

## Verify before your first deploy

```bash
npm install && npm run build     # should produce dist/
cd test && npm install && npm test
```

Expected: 48 passed, 23 passed, and
`8 filled from profile with zero AI calls, 2 escalated`.

The build is the one step that could not be confirmed in the environment this project was
assembled in — every import is verified present in `package.json`, but run it once locally
before pushing.
