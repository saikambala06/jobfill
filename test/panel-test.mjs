/* The side panel only works if the content script actually narrates what it is
   doing. This drives a fill with a stubbed chrome API and asserts the message
   stream a docked panel needs: start, a row per field, and a done.            */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';
const html = `<!doctype html><html><body><form id="application_form">
  <label for="fn">First Name</label><input id="fn">
  <label for="ln">Last Name</label><input id="ln">
  <label for="em">Email</label><input id="em" type="email">
  <label for="why">Why do you want this role?</label><textarea id="why"></textarea>
</form></body></html>`;

const dom = new JSDOM(html, { url: 'https://boards.greenhouse.io/acme/jobs/1', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 });
window.Element.prototype.scrollIntoView = () => {};

/* ---- the messages the panel would receive ------------------------------- */
const sent = [];
let onPageMessage = null;

const PLAN = {
  ok: true,
  data: {
    fills: [
      { uid: 'f0', value: 'Vinitha', via: 'rule', confidence: .97 },
      { uid: 'f1', value: 'N', via: 'rule', confidence: .97 },
      { uid: 'f2', value: 'vineetha2341@gmail.com', via: 'rule', confidence: .97 },
      { uid: 'f3', value: 'Because of the data platform work.', via: 'memory', needsReview: false },
    ],
    stats: { rule: 3, memory: 1, detected: 4, planned: 4, leftBlankOnPurpose: 2 },
    document: null,
    unresolved: [],
    warning: null,
  },
};

window.chrome = {
  runtime: {
    sendMessage: async (msg) => {
      sent.push(msg);
      if (msg.type === 'PLAN_FILL') return PLAN;
      if (msg.type === 'SAVE_ANSWERS') return { ok: true, data: { saved: 4, skipped: 0 } };
      return { ok: true };
    },
    onMessage: { addListener: (fn) => { onPageMessage = fn; } },
  },
  storage: { local: { get: async () => ({ autoFillNewSteps: false }) } },
};

global.window = window;
global.document = window.document;
global.Node = window.Node;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.getComputedStyle = window.getComputedStyle.bind(window);

const load = (f) => new Function(
  'window', 'document', 'location', 'CSS', 'Node', 'getComputedStyle', 'console', 'chrome',
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'KeyboardEvent',
  'InputEvent', 'MouseEvent', 'DragEvent', 'DataTransfer', 'File', 'MutationObserver',
  'NodeFilter', 'setTimeout', 'clearTimeout',
  fs.readFileSync(`${EXT}/content/${f}`, 'utf8'))(
  window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console, window.chrome,
  window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event, window.KeyboardEvent,
  window.InputEvent, window.MouseEvent, window.DragEvent, window.DataTransfer, window.File,
  window.MutationObserver, window.NodeFilter, setTimeout, clearTimeout);

for (const f of ['adapters.js', 'detector.js', 'filler.js', 'overlay.js', 'index.js']) load(f);

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → got ${JSON.stringify(got)}` : ''}`); }
};
const events = () => sent.filter((m) => m.type === 'FILL_EVENT').map((m) => m.payload);
const $ = (id) => window.document.getElementById(id);

/* ---------------------------------------------------------------- run ---- */
t('the content script registered a message listener', typeof onPageMessage === 'function');

onPageMessage({ type: 'RUN_AUTOFILL', payload: { surface: 'sidepanel' } }, null, () => {});
await new Promise((r) => setTimeout(r, 600));

console.log('\n── the panel gets a narratable stream ───────────────────');
const ev = events();
t('a start event opens the trace', ev[0]?.phase === 'start', ev[0]);
t('start carries the detected count', ev[0]?.detected === 4, ev[0]?.detected);
t('one row per planned fill', ev.filter((e) => e.phase === 'row').length === 4,
  ev.filter((e) => e.phase === 'row').length);
t('rows carry a label', ev.find((e) => e.phase === 'row')?.row.label === 'First Name',
  ev.find((e) => e.phase === 'row')?.row.label);
t('rows carry progress', ev.find((e) => e.phase === 'row')?.total === 4);
t('a memory fill is tagged as such',
  ev.some((e) => e.phase === 'row' && e.row.via === 'memory'));
t('a done event closes it', ev.at(-1)?.phase === 'done', ev.at(-1)?.phase);
t('done reports deliberate blanks',
  /left blank because you saved them/.test(ev.at(-1)?.warning || ''), ev.at(-1)?.warning);

console.log('\n── and the form is actually filled ──────────────────────');
t('First Name', $('fn').value === 'Vinitha', $('fn').value);
t('Last Name', $('ln').value === 'N', $('ln').value);
t('Email', $('em').value === 'vineetha2341@gmail.com', $('em').value);
t('Free text', $('why').value.startsWith('Because'), $('why').value);

console.log('\n── the floating overlay stays out of the way ────────────');
t('no in-page panel when the side panel is the surface',
  !window.document.getElementById('jobfill-overlay-host'));

console.log('\n── typing is respected mid-run ──────────────────────────');
$('ln').dataset.jfUserEdited = '1';
$('ln').value = 'typed by hand';
sent.length = 0;
onPageMessage({ type: 'RUN_AUTOFILL', payload: { surface: 'sidepanel' } }, null, () => {});
await new Promise((r) => setTimeout(r, 600));
t('their text survives a second run', $('ln').value === 'typed by hand', $('ln').value);
t('and the panel is told why',
  events().some((e) => e.phase === 'row' && e.row.skipped && /already typed/i.test(e.row.reason || '')),
  events().filter((e) => e.phase === 'row').map((e) => e.row.reason));

console.log('\n── saving reports back to the panel ─────────────────────');
// Clear one box first: a field the user deliberately empties before saving is the
// case that has to be recorded, and every field was filled up to this point.
$('why').value = '';
sent.length = 0;
onPageMessage({ type: 'SAVE_ANSWERS_NOW' }, null, () => {});
await new Promise((r) => setTimeout(r, 400));
t('a saved event reaches the panel', events().some((e) => e.phase === 'saved'), events());
const payload = sent.find((m) => m.type === 'SAVE_ANSWERS')?.payload;
t('answers carry a scope field', payload?.answers?.every((a) => 'scope' in a));
t('a field they emptied is saved as a deliberate skip',
  payload?.answers?.some((a) => a.skipped === true && /why/i.test(a.question)),
  payload?.answers?.map((a) => `${a.question}:${a.skipped}`));
t('the fields they kept are saved with their values',
  payload?.answers?.some((a) => !a.skipped && a.answer === 'typed by hand'));

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
