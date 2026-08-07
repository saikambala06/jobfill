/* Reproduces the WellSky screenshot: a field visibly holding "Hima" while the form
   underneath insists it is empty. Workday commits what you typed to its own model
   when focus leaves the field, so a value written without a bubbling focusout is
   never seen — the DOM has it and the model does not.                          */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';
const html = `<!doctype html><html><body><form>
  <div data-automation-id="formField-firstName">
    <label for="fn">First Name</label><input id="fn" data-automation-id="firstName">
    <div data-automation-id="errorMessage" hidden></div>
  </div>
  <div data-automation-id="formField-lastName">
    <label for="ln">Last Name</label><input id="ln" data-automation-id="lastName">
    <div data-automation-id="errorMessage" hidden></div>
  </div>
  <div data-automation-id="formField-city">
    <label for="ct">City</label><input id="ct" data-automation-id="city">
    <div data-automation-id="errorMessage" hidden></div>
  </div>
</form></body></html>`;

const dom = new JSDOM(html, { url: 'https://wellsky.wd1.myworkdayjobs.com/en-US/wellskycareers/job/Data-Analyst_JR4857/apply', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 });
window.Element.prototype.scrollIntoView = () => {};

global.window = window; global.document = window.document; global.Node = window.Node;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.getComputedStyle = window.getComputedStyle.bind(window);
window.chrome = { runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}) } } };

/* ── a stand-in for Workday's own form model ──────────────────────────────
   It only learns a field's value on focusout, exactly like the real thing, and
   marks the field invalid when its model entry is still empty.                */
const model = new Map();
for (const id of ['fn', 'ln', 'ct']) {
  const el = window.document.getElementById(id);
  model.set(id, '');
  el.addEventListener('focusout', () => {          // bubbling; blur would not reach a delegate
    model.set(id, el.value);
    validate(id);
  });
}
function validate(id) {
  const el = window.document.getElementById(id);
  const box = el.closest('[data-automation-id^="formField"]');
  const err = box.querySelector('[data-automation-id="errorMessage"]');
  const empty = !model.get(id);
  el.setAttribute('aria-invalid', String(empty));
  err.hidden = !empty;
  err.textContent = empty ? `Error: The field ${el.previousElementSibling?.textContent || id} is required and must have a value.` : '';
}
for (const id of ['fn', 'ln', 'ct']) validate(id);

const load = (f) => new Function(
  'window', 'document', 'location', 'CSS', 'Node', 'getComputedStyle', 'console', 'chrome',
  'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'KeyboardEvent',
  'InputEvent', 'FocusEvent', 'MouseEvent', 'DragEvent', 'DataTransfer', 'File',
  'MutationObserver', 'NodeFilter', 'setTimeout', 'clearTimeout',
  fs.readFileSync(`${EXT}/content/${f}`, 'utf8'))(
  window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console, window.chrome,
  window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement, window.Event, window.KeyboardEvent,
  window.InputEvent, window.FocusEvent, window.MouseEvent, window.DragEvent, window.DataTransfer, window.File,
  window.MutationObserver, window.NodeFilter, setTimeout, clearTimeout);

for (const f of ['adapters.js', 'detector.js', 'filler.js']) load(f);
const JF = window.__JOBFILL__;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`); }
};
const $ = (id) => window.document.getElementById(id);

console.log('\n── the form starts out complaining, as it should ────────');
t('First Name is flagged empty', $('fn').getAttribute('aria-invalid') === 'true');
t('and the error text is the one from the screenshot',
  /is required and must have a value/.test($('fn').nextElementSibling?.textContent || ''));

console.log('\n── filling commits the value to the form, not just the DOM ──');
await JF.applyFill({ uid: 'f0', value: 'Hima' }, { uid: 'f0', selector: '#fn', control: 'text', label: 'First Name' }, {});
t('the box shows the name', $('fn').value === 'Hima', $('fn').value);
t('and the form model has it too', model.get('fn') === 'Hima', model.get('fn'));
t('so the required error is gone', $('fn').getAttribute('aria-invalid') === 'false');

await JF.applyFill({ uid: 'f1', value: 'Sindhuja P' }, { uid: 'f1', selector: '#ln', control: 'text', label: 'Last Name' }, {});
await JF.applyFill({ uid: 'f2', value: 'Denton' }, { uid: 'f2', selector: '#ct', control: 'text', label: 'City' }, {});
t('Last Name accepted', model.get('ln') === 'Sindhuja P' && $('ln').getAttribute('aria-invalid') === 'false');
t('City accepted', model.get('ct') === 'Denton' && $('ct').getAttribute('aria-invalid') === 'false');

console.log('\n── errors are found where they are, not page-wide ───────');
t('a healthy field reports no error', JF.fieldError($('fn')) === null, JF.fieldError($('fn')));

// Break one the way a re-render would: DOM keeps the text, model loses it.
model.set('ct', '');
validate('ct');
const found = JF.fieldError($('ct'));
t('a rejected field is detected', Boolean(found), found);
t('and the message is the form\'s own words', /required and must have a value/.test(found || ''));
t('its neighbours are not blamed for it', JF.fieldError($('fn')) === null);

console.log('\n── and it is repaired rather than left broken ───────────');
const fixed = await JF.repairField($('ct'), 'Denton');
t('repair reports success', fixed === true);
t('the model has the value now', model.get('ct') === 'Denton', model.get('ct'));
t('the error has cleared', $('ct').getAttribute('aria-invalid') === 'false');

console.log('\n── a framework value-tracker cannot swallow the write ───');
const tracked = $('fn');
let trackerValue = 'Hima';
tracked._valueTracker = { getValue: () => trackerValue, setValue: (v) => { trackerValue = v; } };
await JF.applyFill({ uid: 'f0', value: 'Himabindu' }, { uid: 'f0', selector: '#fn', control: 'text', label: 'First Name' }, {});
t('the tracker was reset before the write', trackerValue !== 'Hima', trackerValue);
t('the new value landed', $('fn').value === 'Himabindu' && model.get('fn') === 'Himabindu', model.get('fn'));

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
