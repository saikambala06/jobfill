import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';

// A form built the way real ATSs build them: label-for, aria-labelledby, a bare
// sibling div, a table cell, a radio group, a select, a textarea, and a file input.
const html = `<!doctype html><html><body>
<div id="grnhse_app">
<form id="application_form">
  <h3>Personal information</h3>

  <label for="first_name">First Name *</label>
  <input id="first_name" name="job_application[first_name]" type="text" required>

  <label for="last_name">Last Name *</label>
  <input id="last_name" name="job_application[last_name]" type="text" required>

  <div><span id="lbl-email">Email</span>
    <input id="email" type="email" aria-labelledby="lbl-email"></div>

  <div class="field"><div class="label">Phone</div>
    <input id="phone" type="tel"></div>

  <label for="resume">Resume/CV</label>
  <input id="resume" type="file">

  <h3>Details</h3>

  <label for="linkedin">LinkedIn Profile</label>
  <input id="linkedin" type="url">

  <label for="country">Country</label>
  <select id="country">
    <option value="">Please select</option>
    <option value="us">United States</option>
    <option value="in">India</option>
    <option value="gb">United Kingdom</option>
  </select>

  <fieldset>
    <legend>Will you now or in the future require sponsorship for employment visa status?</legend>
    <label for="sp_y">Yes</label><input type="radio" id="sp_y" name="sponsorship" value="Yes">
    <label for="sp_n">No</label><input type="radio" id="sp_n" name="sponsorship" value="No">
  </fieldset>

  <label for="why">Why do you want to work at Acme?</label>
  <textarea id="why" maxlength="1200"></textarea>

  <table><tr><td>Notice period</td><td><input id="notice" type="text"></td></tr></table>

  <input type="hidden" name="csrf_token" value="xyz">
  <input type="submit" value="Submit">
</form>
</div></body></html>`;

const dom = new JSDOM(html, { url: 'https://boards.greenhouse.io/acme/jobs/123', pretendToBeVisual: true });
const { window } = dom;

// jsdom has no layout engine, so getBoundingClientRect returns zeros and every
// field would be judged invisible. Give elements a real box.
window.Element.prototype.getBoundingClientRect = function () {
  return { width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 };
};
window.document.title = 'Senior Engineer at Acme';

global.window = window;
global.document = window.document;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.Node = window.Node;
global.getComputedStyle = window.getComputedStyle.bind(window);
for (const k of ['HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','KeyboardEvent','MouseEvent','InputEvent','DataTransfer','File','DragEvent'])
  if (window[k]) global[k] = window[k];

// Load the content scripts in manifest order, as Chrome would.
for (const f of ['adapters.js','detector.js','filler.js']) {
  const code = fs.readFileSync(`${EXT}/content/${f}`, 'utf8');
  // Content scripts always have `location`; the harness has to supply it explicitly
  // because `new Function` bodies resolve against the Node global, not the JSDOM one.
  new Function('window','document','location','CSS','Node','getComputedStyle','console', code)(
    window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console);
}

const JF = window.__JOBFILL__;
let pass=0, fail=0;
const t=(n,g,w)=>{ const ok = JSON.stringify(g)===JSON.stringify(w); ok?pass++:fail++;
  if(!ok) console.log(`  ✗ ${n}\n      got: ${JSON.stringify(g)}\n     want: ${JSON.stringify(w)}`); };

console.log('\n── adapter detection ────────────────────────────────────');
const adapter = JF.detectAdapter();
t('identifies Greenhouse', adapter.id, 'greenhouse');
console.log(`  adapter: ${adapter.name}`);

console.log('\n── field detection ──────────────────────────────────────');
const { fields, page } = JF.detectFields();
console.log(`  detected ${fields.length} fields on "${page.role}" @ ${page.company}`);
for (const f of fields) console.log(`    ${f.control.padEnd(10)} ${JSON.stringify(f.label).padEnd(72)} ${f.options?.length?`[${f.options.length} opts]`:''}`);

const byLabel = (s) => fields.find((f) => (f.label||'').toLowerCase().includes(s));
t('finds first name (label-for)',     Boolean(byLabel('first name')), true);
t('finds email (aria-labelledby)',    byLabel('email')?.control, 'text');
t('finds phone (sibling div label)',  Boolean(byLabel('phone')), true);
t('finds file input',                 byLabel('resume')?.control, 'file');
t('finds select with options',        byLabel('country')?.options.length, 3);
t('drops the "Please select" option', byLabel('country')?.options.some(o=>/please select/i.test(o.label)), false);
t('groups radios into one question',  byLabel('sponsorship')?.options.length, 2);
t('reads legend as radio label',      byLabel('sponsorship')?.control, 'radio');
t('finds textarea with maxLength',    byLabel('why')?.maxLength, 1200);
t('reads table-cell label',           Boolean(byLabel('notice')), true);
t('excludes hidden + submit inputs',  fields.some(f=>/csrf|submit/i.test(f.name||f.type)), false);
t('captures section headings',        byLabel('first name')?.section, 'Personal information');

console.log('\n── filling ──────────────────────────────────────────────');
const plan = [
  { uid: byLabel('first name').uid, value: 'Priya' },
  { uid: byLabel('email').uid,      value: 'priya@example.com' },
  { uid: byLabel('country').uid,    value: 'India', label: 'India' },
  { uid: byLabel('sponsorship').uid, value: 'No', label: 'No' },
  { uid: byLabel('why').uid,        value: 'Four years shipping payments infrastructure.', needsReview: true },
  { uid: byLabel('notice').uid,     value: '30 days' },
];
for (const fill of plan) {
  const field = fields.find(f=>f.uid===fill.uid);
  const r = await JF.applyFill(fill, field, {});
  if (!r.ok) console.log(`  ✗ fill failed: ${field.label} — ${r.reason}`);
}

const d = window.document;
t('text field written',      d.querySelector('#first_name').value, 'Priya');
t('email field written',     d.querySelector('#email').value, 'priya@example.com');
t('select resolved by text', d.querySelector('#country').value, 'in');
t('radio selected',          d.querySelector('#sp_n').checked, true);
t('other radio untouched',   d.querySelector('#sp_y').checked, false);
t('textarea written',        d.querySelector('#why').value.startsWith('Four years'), true);
t('table-cell field written',d.querySelector('#notice').value, '30 days');

console.log('\n── fill trace markers ───────────────────────────────────');
t('filled field marked',     d.querySelector('#first_name').classList.contains('jf-filled'), true);
t('review field flagged',    d.querySelector('#why').classList.contains('jf-review'), true);
t('non-review not flagged',  d.querySelector('#first_name').classList.contains('jf-review'), false);

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail?1:0);
