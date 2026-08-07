/* Reproduces the bug in the screenshot: Workday shows "The field First Name is
   required and must have a value" under a box that visibly contains a name.

   The form is modelled the way the real one behaves, and each trait here is one
   the old filler tripped over:

     - onBlur is delegated from `focusout` at the root, the way React 17+ does it.
       A dispatched, bubbling `blur` event reaches nothing.
     - the value only enters Workday's model when that handler runs, so the model
       can sit empty under a filled-looking input.
     - React's value tracker suppresses the change when it already holds the
       incoming string.
     - the error node, once shown, stays until something re-validates.            */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';

const html = `<!doctype html><html><body>
<div data-automation-id="jobApplication">
  <div data-automation-id="formField-firstName">
    <label for="fn">First Name</label>
    <input id="fn" data-automation-id="legalNameSection_firstName" aria-invalid="true">
    <div data-automation-id="errorMessage">Error: The field First Name is required and must have a value.</div>
  </div>
  <div data-automation-id="formField-lastName">
    <label for="ln">Last Name</label>
    <input id="ln" data-automation-id="legalNameSection_lastName" aria-invalid="true">
    <div data-automation-id="errorMessage">Error: The field Last Name is required and must have a value.</div>
  </div>
  <div data-automation-id="formField-city">
    <label for="ct">City</label>
    <input id="ct" data-automation-id="addressSection_city">
    <div data-automation-id="errorMessage"></div>
  </div>
  <div data-automation-id="formField-phone">
    <label for="ph">Phone Number</label>
    <input id="ph" data-automation-id="phone-number">
    <div data-automation-id="errorMessage"></div>
  </div>
</div>
</body></html>`;

const dom = new JSDOM(html, { url: 'https://wellsky.wd1.myworkdayjobs.com/en-US/wellskycareers/job/apply', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 220, height: 32, top: 0, left: 0, right: 220, bottom: 32, x: 0, y: 0 });
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

/* ─────────────────────────────────────────────────── the fake Workday ── */
/** Workday's own model. The DOM is just what the user happens to see. */
const model = {};

/**
 * React's value tracker, as React installs it: an instance-level `value`
 * property shadowing the prototype's, plus a cache of the last value seen. A
 * write that leaves the cache matching is treated as "no change" and dropped.
 */
function reactify(input, { mask = false } = {}) {
  let current = input.value;
  const tracker = {
    getValue: () => current,
    setValue: (v) => { current = String(v); },
  };
  input._valueTracker = tracker;

  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return proto.get.call(this); },
    set(v) { current = String(v); proto.set.call(this, v); },
  });

  input.addEventListener('input', () => {
    const shown = proto.get.call(input);
    if (tracker.getValue() === shown) return;   // tracker says nothing changed
    tracker.setValue(shown);
    input.dataset.reactSaw = shown;
  });

  // A masked control: rejects a value that arrives in one go, the way phone and
  // date boxes that re-format per keystroke do.
  if (mask) {
    input.addEventListener('input', (e) => {
      if (e.inputType === 'insertText' && String(e.data || '').length > 3) {
        proto.set.call(input, '');
        tracker.setValue('');
      }
    });
  }
}

/**
 * Validation, delegated from the root on `focusout` — the React 17 shape, and the
 * reason a bubbling `blur` event achieved nothing here.
 */
const root = window.document.querySelector('[data-automation-id="jobApplication"]');
root.addEventListener('focusout', (e) => {
  const input = e.target;
  if (!input.dataset || input.tagName !== 'INPUT') return;
  const cell = input.closest('[data-automation-id^="formField"]');
  const label = cell.querySelector('label').textContent;
  const value = input.dataset.reactSaw ?? '';

  model[label] = value;
  const err = cell.querySelector('[data-automation-id="errorMessage"]');
  if (value.trim()) {
    err.textContent = '';
    input.setAttribute('aria-invalid', 'false');
  } else {
    err.textContent = `Error: The field ${label} is required and must have a value.`;
    input.setAttribute('aria-invalid', 'true');
  }
});

for (const id of ['fn', 'ln', 'ct']) reactify($(id));
reactify($('ph'), { mask: true });

/* ─────────────────────────────────────────────── the reported failure ── */
console.log('\n── the form is complaining before we start ─────────────');
t('Workday is flagging First Name', /required and must have a value/.test(JF.fieldError($('fn'))));
t('and the filler can see that it is', Boolean(JF.fieldError($('ln'))));
t('a clean field is not flagged', JF.fieldError($('ct')) === '', JF.fieldError($('ct')));

/* ── the old approach, kept here so the fix cannot silently regress back ── */
console.log('\n── what the old write did ──────────────────────────────');
{
  const el = $('ct');
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  proto.set.call(el, 'Denton');
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  el.dispatchEvent(new window.Event('blur', { bubbles: true }));   // reaches nothing
  t('the box shows the value', el.value === 'Denton', el.value);
  t('but Workday never received it', model.City === undefined, model.City);
  proto.set.call(el, '');
  el._valueTracker.setValue('');
  delete el.dataset.reactSaw;
}

/* ───────────────────────────────────────────────────────── the fix ───── */
console.log('\n── filling through applyFill ───────────────────────────');
const field = (id, label) => ({
  uid: id, control: 'text', label, selector: `#${id}`,
});

const r1 = await JF.applyFill({ uid: 'fn', value: 'Hima' }, field('fn', 'First Name'), {});
const r2 = await JF.applyFill({ uid: 'ln', value: 'Sindhuja P' }, field('ln', 'Last Name'), {});
const r3 = await JF.applyFill({ uid: 'ct', value: 'Denton' }, field('ct', 'City'), {});

t('First Name reports filled', r1.ok === true, r1);
t('and Workday actually holds it', model['First Name'] === 'Hima', model['First Name']);
t('Last Name reaches the model too', model['Last Name'] === 'Sindhuja P', model['Last Name']);
t('City as well', model.City === 'Denton', model.City);

console.log('\n── and the errors clear ────────────────────────────────');
t('First Name is no longer flagged', JF.fieldError($('fn')) === '', JF.fieldError($('fn')));
t('Last Name is no longer flagged', JF.fieldError($('ln')) === '', JF.fieldError($('ln')));
t('aria-invalid was cleared', $('fn').getAttribute('aria-invalid') === 'false');

/* ─────────────────────────────────────── a control that rejects a bulk write ── */
console.log('\n── a masked field that refuses one-shot writes ─────────');
const r4 = await JF.applyFill({ uid: 'ph', value: '4695551234' }, field('ph', 'Phone Number'), {});
t('the retry gets it in', r4.ok === true, r4);
t('the box holds the number', $('ph').value === '4695551234', $('ph').value);
t('and so does the model', model['Phone Number'] === '4695551234', model['Phone Number']);

/* ──────────────────────────────────────────────── the repair sweep ───── */
console.log('\n── the sweep repairs what the form reverted ────────────');
{
  // A late re-render blanks the box and re-raises the error, which is exactly
  // what left a "filled" Workday step refusing to advance.
  const el = $('ct');
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  proto.set.call(el, '');
  el._valueTracker.setValue('');
  delete el.dataset.reactSaw;
  el.setAttribute('aria-invalid', 'true');
  el.closest('[data-automation-id^="formField"]').querySelector('[data-automation-id="errorMessage"]')
    .textContent = 'Error: The field City is required and must have a value.';

  t('the field is flagged again', Boolean(JF.fieldError(el)));
  const repaired = await JF.revalidate(
    [{ selector: '#ct', value: 'Denton', label: 'City' }],
    { slowRender: 10 },
  );
  t('the sweep reports the repair', repaired.includes('City'), repaired);
  t('the value is back', el.value === 'Denton', el.value);
  t('the model agrees', model.City === 'Denton', model.City);
  t('and the error is gone', JF.fieldError(el) === '', JF.fieldError(el));
}

console.log('\n── it never fights the user for a field ────────────────');
{
  const el = $('ct');
  el.dataset.jfUserEdited = '1';          // they typed here after we filled it
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  proto.set.call(el, 'Dallas');
  const repaired = await JF.revalidate([{ selector: '#ct', value: 'Denton', label: 'City' }], { slowRender: 10 });
  t('their value stands', el.value === 'Dallas', el.value);
  t('and the sweep leaves it alone', repaired.length === 0, repaired);
}

console.log('\n── a standing hint is not a complaint ──────────────────');
{
  // Plenty of forms print this beside every mandatory box, always. Reading it as
  // a failure would send the slow retry path over a whole page of correct fields.
  const cell = window.document.createElement('div');
  cell.setAttribute('data-automation-id', 'formField-hinted');
  cell.innerHTML = '<label for="hn">Postcode</label><input id="hn"><span class="hint">Required</span>';
  window.document.body.append(cell);
  t('"Required" on its own is ignored', JF.fieldError($('hn')) === '', JF.fieldError($('hn')));

  cell.querySelector('.hint').className = 'error';
  t('even under an error class', JF.fieldError($('hn')) === '', JF.fieldError($('hn')));

  cell.querySelector('.error').textContent = 'Error: The field Postcode is required and must have a value.';
  t('but a real complaint is caught', /required and must have/.test(JF.fieldError($('hn'))));

  cell.querySelector('.error').setAttribute('hidden', '');
  t('and a retracted one is not', JF.fieldError($('hn')) === '', JF.fieldError($('hn')));
}

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
