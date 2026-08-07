/* The two fixes that only exist in the browser: never overwriting what the user
   is typing, and a panel that survives a click on the page underneath it.     */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';
const html = `<!doctype html><html><body><form>
  <label for="a">Given Name</label><input id="a">
  <label for="b">Family Name</label><input id="b">
  <label for="c">Why do you want this role?</label><textarea id="c"></textarea>
</form></body></html>`;

const dom = new JSDOM(html, { url: 'https://boards.greenhouse.io/acme/jobs/1', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 });
window.Element.prototype.scrollIntoView = () => {};

global.window = window;
global.document = window.document;
global.Node = window.Node;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.getComputedStyle = window.getComputedStyle.bind(window);
window.chrome = { runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}) } } };

const load = (f) => new Function(
  'window', 'document', 'location', 'CSS', 'Node', 'getComputedStyle', 'console', 'chrome',
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'KeyboardEvent',
  'InputEvent', 'MouseEvent', 'DragEvent', 'DataTransfer', 'File', 'MutationObserver', 'NodeFilter',
  fs.readFileSync(`${EXT}/content/${f}`, 'utf8'))(
  window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console, window.chrome,
  window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event, window.KeyboardEvent,
  window.InputEvent, window.MouseEvent, window.DragEvent, window.DataTransfer, window.File,
  window.MutationObserver, window.NodeFilter);

for (const f of ['adapters.js', 'detector.js', 'filler.js', 'overlay.js']) load(f);
const JF = window.__JOBFILL__;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → got ${JSON.stringify(got)}` : ''}`); }
};

const $ = (id) => window.document.getElementById(id);
/* ------------------------------------------------------------- ownership -- */
console.log('\n── the extension knows whose text it is ─────────────────');
t('an empty field is free to fill', !JF.isUserOccupied($('a')));

await JF.applyFill({ uid: 'f0', value: 'Vinitha' }, { uid: 'f0', selector: '#a', control: 'text', label: 'Given Name' }, {});
t('our own write lands', $('a').value === 'Vinitha', $('a').value);
t('a field we filled is still ours to refill', !JF.isUserOccupied($('a')));

await JF.applyFill({ uid: 'f0', value: 'CORRECTED' }, { uid: 'f0', selector: '#a', control: 'text', label: 'Given Name' }, {});
t('so a re-run can correct it', $('a').value === 'CORRECTED', $('a').value);

console.log('\n── but never overwrites a person mid-sentence ───────────');
const c = $('c');
c.value = 'I want this role because';
c.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'e' }));
c.dataset.jfUserEdited = '1';                       // what the trusted listener sets
t('a typed-in field reads as occupied', JF.isUserOccupied(c));

const blocked = await JF.applyFill(
  { uid: 'f2', value: 'Some AI-written paragraph.' },
  { uid: 'f2', selector: '#c', control: 'textarea', label: 'Why do you want this role?' }, {});
t('the fill is refused', blocked.ok === false && blocked.skipped === true, blocked);
t('their half-written sentence survives intact',
  c.value === 'I want this role because', c.value);

console.log('\n── a field they cleared stays theirs ────────────────────');
c.value = '';
t('still occupied after they delete it', JF.isUserOccupied(c));
const blocked2 = await JF.applyFill(
  { uid: 'f2', value: 'Filler text' },
  { uid: 'f2', selector: '#c', control: 'textarea', label: 'Why' }, {});
t('and still not refilled behind their back', blocked2.ok === false && c.value === '', c.value);

console.log('\n── a value someone pasted in is respected ───────────────');
const b = $('b');
b.value = 'Typed by hand';
t('non-empty text we did not write is occupied', JF.isUserOccupied(b));

/* ----------------------------------------------------------------- panel -- */
console.log('\n── the panel closes only when asked ─────────────────────');
t('starts closed', !JF.overlay.isOpen());

JF.overlay.open({ title: 'Filling', stats: { detected: 3 } });
t('opens on the toolbar click', JF.overlay.isOpen());
t('and is actually in the page', Boolean(window.document.getElementById('jobfill-overlay-host')));

window.document.body.click();
$('a').focus();
$('a').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
t('a click on the form does not dismiss it', JF.overlay.isOpen());

JF.overlay.toggle();
t('a second toolbar click closes it', !JF.overlay.isOpen());
t('and removes it from the page', !window.document.getElementById('jobfill-overlay-host'));

JF.overlay.toggle();
t('a third click brings it back', JF.overlay.isOpen());
t('with its rows intact', JF.overlay.state.title === 'Filling', JF.overlay.state.title);

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
