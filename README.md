# JobFill

AI job-application autofill. A Chrome extension reads whatever application form is in
front of you and fills it from one saved profile; a dashboard is where that profile,
your résumé and your written answers live.

Works on Greenhouse, Lever, Workday, Ashby, SmartRecruiters, iCIMS, Taleo, SAP
SuccessFactors, Oracle Recruiting, BambooHR, Jobvite, Teamtailor, Recruitee, JazzHR,
Zoho Recruit, Bullhorn, ADP, UKG, CareerBuilder, Indeed, LinkedIn Easy Apply, Monster,
Naukri, Foundit, Dice, Wellfound, and generic company career pages.

```
jobfill-ai/
├── package.json   one dependency set for the whole project
├── vercel.json    build, output and routing for a single Vercel project
├── api/index.js   the serverless function entry
├── server/src/    Express + MongoDB app the function imports
├── dashboard/     React + Vite source, built to dist/
└── extension/     Chrome MV3 extension — load unpacked, no build step
```

Everything deploys as **one Vercel project**: the dashboard as static files, the API as a
single function on the same domain. See [DEPLOY.md](DEPLOY.md).

---

## How the filling actually works

Three tiers, cheapest first. This is the central design decision and it is what keeps a
60-field Workday page fast instead of expensive.

| Tier | What it does | Cost |
|---|---|---|
| **1. Rules** | ~60 regex rules with negative matching map labels to canonical profile keys. HTML `autocomplete` tokens beat text heuristics when present. | No network, no tokens |
| **2. Memory** | Questions you have answered before, matched by character-trigram + stemmed word overlap at a 0.82 threshold. | No network, no tokens |
| **3. AI planner** | Groq sees **only** what tiers 1–2 could not resolve. | One call per page |

On a representative Greenhouse form, **8 of 10 fields fill with zero AI calls** — only a
genuinely custom question ("Why do you want to work at Acme?") reaches the model.

Groq (`llama-3.3-70b-versatile`) is primary. Anthropic (`claude-sonnet-4-6`) is the
automatic failover and the preferred model for long-form written answers.

### Why not embeddings for repeated questions

Groq exposes no embedding endpoint, and application questions are short and formulaic —
they repeat near-verbatim across postings. Local lexical similarity avoids a network hop
per question, costs nothing, and degrades into "no match" instead of hallucinating a
wrong answer into someone's application. The threshold is deliberately conservative for
the same reason: a missed reuse is a minor annoyance, a wrong auto-filled answer is not.

---

## Setup

Requires Node 18+.

### 1. MongoDB

Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas). Under
**Database Access** add a user; under **Network Access** allow `0.0.0.0/0` (Vercel's
function IPs are not fixed). Copy the connection string from **Connect → Drivers**.

### 2. Groq API key

Sign in at [console.groq.com/keys](https://console.groq.com/keys) and create a key. It
starts with `gsk_`. Groq's free tier is generous enough for personal use.

### 3. Anthropic API key (optional)

From [console.anthropic.com](https://console.anthropic.com/settings/keys). Without it the
app runs on Groq alone; with it you get failover and better long-form answers.

### 4. Install and configure

```bash
npm install
cp .env.example .env      # then fill in the values
```

Generate a JWT secret with `openssl rand -base64 48`.

### 5. Run both halves

Two processes — Vite serves the dashboard, Node runs the API:

```bash
npm run dev:api           # terminal 1 — http://localhost:4000
npm run dev               # terminal 2 — http://localhost:5173
```

Vite proxies `/api` to port 4000 in development, so there is no CORS setup locally. Check
the API came up — the health endpoint reports which providers it found:

```bash
curl http://localhost:4000/api/health
```

### 6. Load the extension

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `extension/` folder

There is no build step; the extension is plain files.

Create your account from the popup, then open the dashboard to fill in your details and
upload a résumé. Uploading a résumé populates your work history, education and skills
automatically — anything you already typed is never overwritten.

---

## Deployment

One Vercel project, zero config beyond environment variables — import the repo, leave
Root Directory as `./`, add your keys. Full walkthrough in [DEPLOY.md](DEPLOY.md).

The one step people skip: after deploying, set the API address in the **extension popup →
Server**. It ships pointed at `localhost:4000`.

---

## Using it

| Action | How |
|---|---|
| Fill the current application | Click the extension, or `Alt+Shift+F` |
| Save your answers from a page | "Save answers" in the overlay, or `Alt+Shift+S` |
| Rewrite a long answer | "Rewrite" button on that field in the overlay |

After a fill, the overlay groups results into **Check before you submit**, **Filled from
your profile**, and **Left blank — no matching data**. On the page itself, a blue
underline means filled from your data and a pink one means check it. Both clear the
moment you edit the field.

Anything flagged pink is flagged for a reason: salary, notice period, visa status, work
authorisation and criminal-record questions always land there, along with anything the
model wrote or was less than 75% confident about.

### What it will not do

- **EEO and demographic fields are skipped by default.** They only fill if you turn on
  `fillEEO`, and only from values you typed yourself. Race, gender, disability and veteran
  status are never inferred from your name or anything else.
- **It never overwrites what you have already typed.** Prefilled fields are excluded
  before the plan is even built.
- **It omits rather than guesses.** The planner is instructed that leaving a field blank
  is a good outcome, and it will not invent employers, dates, degrees, salary figures or
  credentials.
- **It does not submit anything.** Filling and submitting are separate; you press submit.

---

## Architecture notes

**The token lives only in the service worker.** Content scripts run inside the job
board's page context, so a hostile or compromised careers page can never read your
credentials. Every network call is brokered through `chrome.runtime.sendMessage`.

**Native value setters.** The single most common reason autofill breaks on a modern ATS
is that `input.value = x` updates the DOM but not React's internal value tracker, so the
next render wipes it. `filler.js` calls the *native* setter off the prototype, bypassing
React's patched property, then dispatches a bubbling `input` event.

**Label resolution is five strategies deep** — `label[for]`, `aria-labelledby`, table
cell, a proximity walk that stops when a container holds more than one control, and
placeholder/title/`data-automation-id` humanisation. Real forms use all of them.

**Serverless connection reuse.** `db.js` caches the connection *promise*, not just the
connection, so concurrent cold starts collapse into a single Atlas handshake instead of
exhausting the connection limit.

**Answers upsert on a normalised key**, so the same question asked on ten different job
boards collapses to one row with a rising `timesUsed` count.

---

## Testing

```bash
cd test
npm install     # jsdom must be installed here — Node's ESM loader ignores NODE_PATH
npm test
```

Or individually:

```bash
node test.mjs           # matcher + similarity — 48 cases, no jsdom needed
node dom-test.mjs       # detect → fill → mark in jsdom — 23 cases
node pipeline-test.mjs  # detector output → server matcher, end to end
```

Five real bugs were found and fixed by these suites during the build:

1. Short decisive keywords ("zip", "disab") were penalised by length-based coverage
   scoring and fell below threshold. Scoring now takes the longest regex alternative and
   treats long or interrogative labels as questions needing more evidence — so
   "Zip / Postal Code" resolves, while "Describe a time you had to relocate a project
   deadline" correctly does **not** map to `willingToRelocate`.
2. "Cover Letter" as a file input matched `coverLetterText`. Control type is now a hard
   eligibility constraint, because the labels are identical and scoring alone cannot
   separate them.
3. A confidence cap applied inside the scoring loop flattened two strong candidates into
   a tie, handing the win to rule order.
4. Radio groups read a stray earlier label instead of their `<legend>`.
5. Table-cell labels (Taleo, iCIMS, older career pages) were missed because `td` was
   absent from the proximity walk.

---

## Known issues

- **`dashboard/.broken_nm_ignore` and `.broken_nm2_ignore`** are corrupted partial
  `npm install` directories left by the build sandbox's filesystem. They are not part of
  the project — delete them after cloning. `.gitignore` entries are included.
- **The production build was not verified end to end** in the build environment, because
  `npm install` kept being truncated there. Every source file compiles cleanly under
  esbuild, and an audit confirms all 17 bare imports — including the lazy `pdf-parse` and
  `mammoth` ones — are declared in `package.json`. Still, run
  `npm install && npm run build` before your first deploy.
- Résumés are stored inline in MongoDB with a 4 MB cap. For heavier use, swap
  `routes/resumes.js` to Vercel Blob or S3 — the model already has a `storageUrl` field
  for exactly this.
- The rate limiter is per-container in-memory. Fine for one or two instances; move it to
  Upstash Redis if you scale out.

---

## Design

The interface is built from an application form's own materials, because that is the
subject: monospace field keys, hairline and dotted rules, register marks, and the two ink
colours a real multi-part form uses — ballpoint blue for what you wrote, carbon pink for
the copy underneath.

- **Palette** — ink `#14161C`, cool paper `#E9EBEF`, carbon `#C8CEDA`, ballpoint blue
  `#2B4CF2`, form pink `#F25C7A`, highlighter `#E0A82E`
- **Type** — Bricolage Grotesque (display), **Public Sans** (body — the typeface designed
  for US government forms), IBM Plex Mono (field keys)
- **Signature element** — the carbon-copy fill trace: a form line inks itself
  left-to-right in blue with a pink copy trailing a beat behind and snapping into
  register. Used once, on the Overview hero, and echoed in the sign-in art and the
  extension's in-page markers. Boldness spent in one place.

`prefers-reduced-motion` is respected throughout.
