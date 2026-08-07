/**
 * Field filling.
 *
 * The single most common reason autofill fails on a modern ATS: assigning
 * `input.value = x` updates the DOM but not React's internal value tracker, so the
 * next re-render wipes it. The fix is to call the *native* value setter from the
 * prototype (bypassing React's patched property) and then dispatch a bubbling
 * `input` event, which is what React's synthetic system actually listens for.
 */
(() => {
  const JF = (window.__JOBFILL__ = window.__JOBFILL__ || {});

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * What *we* put in each control, so a later pass can tell our own writing apart
   * from the user's. Without this the only signal is "the box is non-empty", which
   * cannot distinguish a value we wrote a second ago from one the user is halfway
   * through typing — and that ambiguity is what let a re-scan overwrite live input.
   */
  const written = new WeakMap();

  /**
   * True when the control belongs to the user right now and must not be touched.
   *
   * Focus deliberately is *not* one of the signals. Filling a form focuses each
   * field in turn, so treating "is focused" as "is theirs" made the extension
   * refuse to correct a field it had itself just written a moment earlier. What
   * actually marks a field as the user's is a trusted keystroke, or content that
   * we cannot account for. Focus alone still blocks *automatic* re-runs — that
   * check lives in the orchestrator, where it belongs.
   */
  JF.isUserOccupied = function isUserOccupied(el) {
    if (!el) return false;
    if (el.dataset?.jfUserEdited === '1') return true;          // they typed or pasted here
    const current = el.isContentEditable ? el.textContent : el.value;
    if (!String(current ?? '').trim()) return false;            // empty is fair game
    return written.get(el) !== String(current);                 // non-empty and not ours
  };

  JF.claim = (el, value) => { if (el) written.set(el, String(value)); };

  /* --------------------------------------------------------- native set -- */
  const nativeSetters = {
    input: Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set,
    textarea: Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set,
    select: Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set,
  };

  function setNativeValue(el, value) {
    // React caches the last value it saw on the node and ignores an `input` event
    // whose value matches that cache. Clearing the tracker first guarantees the
    // change is seen as a change.
    const tracker = el._valueTracker;
    if (tracker?.setValue) { try { tracker.setValue(''); } catch { /* not React */ } }

    const setter = nativeSetters[el.tagName.toLowerCase()];
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  /**
   * Fire the event sequence a real user produces. Order matters: Angular listens
   * on `input` + `blur`, React on `input` + `change`, Vue on `input`, and several
   * validation libraries only run on `blur`.
   */
  function fireEvents(el, { keys = false } = {}) {
    const opts = { bubbles: true, cancelable: true };
    if (keys) {
      el.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: 'a' }));
      el.dispatchEvent(new KeyboardEvent('keypress', { ...opts, key: 'a' }));
    }
    // A plain Event named "input" is not an InputEvent. Frameworks that read
    // `inputType` treat the plain one as synthetic and ignore it.
    try {
      el.dispatchEvent(new InputEvent('input', { ...opts, inputType: 'insertText', data: String(el.value ?? '') }));
    } catch {
      el.dispatchEvent(new Event('input', opts));
    }
    el.dispatchEvent(new Event('change', opts));
    if (keys) el.dispatchEvent(new KeyboardEvent('keyup', { ...opts, key: 'a' }));
  }

  /**
   * Make the page believe the user has finished with this field.
   *
   * This is the step that was missing, and it is why Workday kept reporting
   * "First Name is required and must have a value" under a box that plainly had a
   * name in it. Workday commits what you typed to its own model when focus leaves,
   * and the old code dispatched `new Event('blur')` — which does not bubble, so a
   * handler listening on the form container never heard it — without ever moving
   * focus. The value sat in the DOM and nowhere else.
   */
  function commitField(el) {
    // FocusEvent is the right constructor but not guaranteed to exist in every
    // context this script runs in; a bubbling Event of the same name is read
    // identically by a listener.
    const Focus = window.FocusEvent || window.Event || Event;
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    // focusout is the bubbling counterpart of blur, and the one React's onBlur
    // and Workday's own delegated handlers are actually listening for.
    el.dispatchEvent(new Focus('focusout', { bubbles: true, cancelable: false }));
    el.dispatchEvent(new Focus('blur', { bubbles: false, cancelable: false }));
    try { el.blur(); } catch { /* detached */ }
  }

  function focusFirst(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus({ preventScroll: true });
    } catch { /* detached nodes are non-fatal */ }
  }

  /* -------------------------------------------------------------- text --- */
  /**
   * One write, not a clear-then-write. The old two-phase version fired an `input`
   * event carrying an empty string first, which on re-rendering forms (Workday,
   * SuccessFactors) kicked off a validation round-trip per field and occasionally
   * landed *after* the real value, blanking it. It also doubled the event traffic,
   * which is most of where the sluggishness came from.
   */
  async function fillText(el, value, { blur = true } = {}) {
    const want = String(value);
    focusFirst(el);
    setNativeValue(el, want);
    JF.claim(el, want);
    fireEvents(el, { keys: true });
    if (blur) commitField(el);

    // Some frameworks re-render the control between the write and the commit and
    // hand back an empty box. One retry against the live node fixes it; a second
    // would just be thrashing.
    if (String(el.value) !== want) {
      await sleep(60);
      focusFirst(el);
      setNativeValue(el, want);
      JF.claim(el, want);
      fireEvents(el, { keys: true });
      if (blur) commitField(el);
    }
    return String(el.value) === want;
  }

  /** contenteditable rich-text areas (Lever's cover-letter box, some Workday notes). */
  async function fillRichText(el, value) {
    focusFirst(el);
    el.innerHTML = '';
    // execCommand is deprecated but remains the only reliable way to produce an
    // input event that rich-text editors (Quill, ProseMirror, Draft) will honour.
    const inserted = document.execCommand?.('insertText', false, String(value));
    if (!inserted) el.textContent = String(value);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value) }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  /* ------------------------------------------------------------ select --- */
  /**
   * Substring matching is only safe on a short list. On a 200-entry country or
   * dial-code dropdown "contains" matches dozens of options and the first one in
   * document order wins — which is how a US phone number came out as Albania.
   * Long lists therefore demand an exact or whole-word match, and failing that we
   * leave the field alone rather than commit a guess.
   */
  async function fillSelect(el, value) {
    const target = JF.normalize(String(value));
    if (!target) return false;
    const opts = [...el.options];
    const loose = opts.length <= 25;

    let chosen = opts.find((o) => o.value === value)
      || opts.find((o) => JF.normalize(o.textContent) === target)
      || opts.find((o) => {
        const t = JF.normalize(o.textContent);
        return t.startsWith(`${target} `) || t.endsWith(` ${target}`) || t.split(' ').includes(target);
      });

    if (!chosen && loose) {
      chosen = opts.find((o) => {
        const t = JF.normalize(o.textContent);
        return t.includes(target) || target.includes(t);
      });
    }

    if (!chosen) return false;
    focusFirst(el);
    setNativeValue(el, chosen.value);
    el.selectedIndex = chosen.index;
    fireEvents(el);
    return true;
  }

  async function fillMultiSelect(el, values) {
    const wanted = (Array.isArray(values) ? values : [values]).map((v) => JF.normalize(String(v)));
    let hit = false;
    for (const opt of el.options) {
      const match = wanted.some((w) => JF.normalize(opt.textContent) === w || opt.value === w);
      if (match) { opt.selected = true; hit = true; }
    }
    if (hit) fireEvents(el);
    return hit;
  }

  /* ------------------------------------------------- radio & checkbox ---- */
  async function fillRadio(field, value, root = document) {
    const target = JF.normalize(String(value));
    for (const opt of field.options || []) {
      const el = root.querySelector(opt.selector);
      if (!el) continue;
      const label = JF.normalize(opt.label || opt.value);
      // Substring matching is wrong here and dangerously so on eligibility
      // questions: "no" is a substring of "No, I do not require sponsorship" but
      // also of "Not applicable", and "yes" matches both "Yes" and "Yes, but…".
      // Exact first, then whole-word, and nothing else.
      const words = label.split(' ');
      const exact = label === target || el.value === value;
      const wordHit = words[0] === target || words.includes(target);
      if (exact || wordHit) {
        // Clicking the label rather than the input keeps custom-styled radios in sync.
        const clickable = el.closest('label') || document.querySelector(`label[for="${CSS.escape(el.id)}"]`) || el;
        focusFirst(el);
        clickable.click();
        if (!el.checked) { el.checked = true; fireEvents(el); }
        return true;
      }
    }
    return false;
  }

  async function fillCheckbox(el, value) {
    const want = value === true || value === 'true' || value === 'Yes' || value === 'yes';
    if (el.checked === want) return true;
    focusFirst(el);
    (el.closest('label') || el).click();
    if (el.checked !== want) { el.checked = want; fireEvents(el); }
    return true;
  }

  /* --------------------------------------------------------- combobox ---- */
  /**
   * The div-soup dropdown. Workday, Ashby, react-select and Oracle all follow the
   * same shape: focus/click opens a listbox somewhere in the DOM (often portalled
   * to body, so we search globally), typing filters it, clicking an option commits.
   */
  async function fillCombobox(el, value, quirks = {}) {
    const target = JF.normalize(String(value));
    if (!target) return false;

    focusFirst(el);
    el.click();
    await sleep(quirks.slowRender || 180);

    // Type to filter when the widget accepts text.
    const typeable = el.tagName === 'INPUT' || el.isContentEditable;
    if (typeable) {
      setNativeValue(el, String(value).slice(0, 40));
      fireEvents(el, { keys: true });
      await sleep(quirks.slowRender || 320);
    }

    const options = await waitForOptions(el, quirks.slowRender || 400);
    if (!options.length) {
      if (typeable && el.value) { JF.claim(el, el.value); return true; }
      return false;
    }

    // Scored the same way as a <select>: exact, then whole-word, then — only when
    // the list is short enough for it to mean anything — substring.
    const loose = options.length <= 25;
    let best = null;
    for (const opt of options) {
      const text = JF.normalize(opt.innerText || opt.textContent || '');
      if (!text) continue;
      let score = 0;
      if (text === target) score = 1;
      else if (text.startsWith(`${target} `) || text.endsWith(` ${target}`)) score = 0.93;
      else if (text.split(' ').includes(target)) score = 0.88;
      else if (loose && (text.includes(target) || target.includes(text))) score = 0.78;
      if (score > (best?.score ?? 0)) best = { el: opt, score, text };
    }

    if (best && best.score >= 0.85) {
      best.el.scrollIntoView({ block: 'nearest' });
      best.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      best.el.click();
      await sleep(120);
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      // Verify rather than assume. A listbox that ignored the click leaves the
      // widget showing whatever was highlighted — usually the first row, which is
      // how an alphabetical dial-code list commits "Albania" to every applicant.
      const settled = JF.normalize(el.value || el.textContent || comboboxDisplay(el));
      if (settled && !settled.includes(best.text) && !best.text.includes(settled)) {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
        return false;
      }
      JF.claim(el, el.value ?? '');
      return true;
    }

    // Nothing matched confidently. Clear anything we typed so the page is not left
    // holding a half-filtered string, and leave the field blank — an empty field
    // the user notices beats a wrong one they do not.
    if (typeable) { setNativeValue(el, ''); fireEvents(el); }
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    return false;
  }

  /** What a div-soup combobox is currently showing, for the verify step. */
  function comboboxDisplay(el) {
    const owned = el.getAttribute('aria-activedescendant');
    if (owned) return document.getElementById(owned)?.textContent || '';
    return el.closest('[role="combobox"]')?.textContent || '';
  }

  /**
   * Only ever look inside the listbox this combobox owns.
   *
   * Searching the whole document picked up options belonging to other widgets —
   * a menu left open elsewhere, or a hidden template list — and scored them as if
   * they were candidates for this field.
   */
  async function waitForOptions(el, timeout) {
    const SEL = '[role="option"], [role="listbox"] li, .select2-results__option, [class*="option"][id], li[data-value]';
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const owns = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const box = (owns && document.getElementById(owns))
        || document.getElementById(el.getAttribute('aria-activedescendant') || '')?.closest('[role="listbox"]')
        || el.closest('[role="combobox"]')?.parentElement?.querySelector('[role="listbox"]');

      const scope = box || document;
      const found = [...scope.querySelectorAll(SEL)].filter((o) => JF.isVisible(o));
      if (found.length) return found;
      await sleep(60);
    }
    return [];
  }

  /* -------------------------------------------------------------- date --- */
  async function fillDate(el, value, field) {
    const iso = String(value).slice(0, 10);
    if (el.type === 'date') return fillText(el, iso);
    if (el.type === 'month') return fillText(el, iso.slice(0, 7));

    // Text-based date input: honour the page's own format hint.
    const [y, m, d] = iso.split('-');
    const hint = (field?.formatHint || el.placeholder || 'MM/DD/YYYY').toUpperCase();
    let out = hint.includes('DD/MM') ? `${d}/${m}/${y}`
      : hint.includes('YYYY-MM') ? iso
        : `${m}/${d}/${y}`;
    if (hint.includes('-') && !hint.startsWith('YYYY')) out = out.replace(/\//g, '-');
    return fillText(el, out);
  }

  /* -------------------------------------------------------------- file --- */
  /**
   * Attach a document by rebuilding a File from a data URL and writing it into the
   * input's FileList via DataTransfer — the only way to set files programmatically.
   */
  async function attachFile(el, doc) {
    try {
      const blob = await (await fetch(doc.dataUrl)).blob();
      const file = new File([blob], doc.filename, { type: doc.mimeType || blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Drag-and-drop zones listen for `drop` instead of `change`.
      const zone = el.closest('[class*="dropzone"], [class*="drag"], [data-automation-id*="file"]');
      if (zone) {
        zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      }
      return true;
    } catch (err) {
      console.warn('[jobfill] file attach failed', err);
      return false;
    }
  }

  /* ------------------------------------------------------------ dispatch -- */
  JF.normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Apply one planned fill. Returns a result record used for the review panel.
   */
  JF.applyFill = async function applyFill(fill, field, ctx = {}) {
    const root = document;
    const el = field.control === 'radio' ? root.querySelector(field.options?.[0]?.selector) : root.querySelector(field.selector);
    if (!el && field.control !== 'radio') return { uid: fill.uid, ok: false, reason: 'Field is no longer on the page' };

    // Re-check ownership at the moment of writing, not at detection time. A plan
    // takes a second or two to come back and the user may well have started typing
    // in the meantime; the detection-time `prefilled` flag is stale by then.
    if (el && field.control !== 'radio' && field.control !== 'checkbox' && JF.isUserOccupied(el)) {
      return { uid: fill.uid, ok: false, reason: 'You had already typed here', skipped: true, label: field.label };
    }

    try {
      let ok = false;
      switch (field.control) {
        case 'file':
          ok = ctx.document ? await attachFile(el, ctx.document) : false;
          break;
        case 'radio':
          ok = await fillRadio(field, fill.label ?? fill.value, root);
          break;
        case 'checkbox':
          ok = await fillCheckbox(el, fill.value);
          break;
        case 'select':
          ok = await fillSelect(el, fill.value) || await fillSelect(el, fill.label);
          break;
        case 'multiselect':
          ok = await fillMultiSelect(el, fill.value);
          break;
        case 'combobox':
          ok = await fillCombobox(el, fill.label ?? fill.value, ctx.quirks);
          break;
        case 'date':
          ok = await fillDate(el, fill.value, field);
          break;
        case 'richtext':
          ok = await fillRichText(el, fill.value);
          break;
        default:
          ok = await fillText(el, fill.value);
      }

      if (ok) JF.markFilled(el === null ? root.querySelector(field.options?.[0]?.selector) : el, fill);
      return { uid: fill.uid, ok, value: fill.value, label: field.label, via: fill.via, needsReview: fill.needsReview };
    } catch (err) {
      return { uid: fill.uid, ok: false, reason: err.message };
    }
  };

  /**
   * The carbon-copy trace: a filled field gets a ballpoint-blue rule, and anything
   * flagged for review gets the pink one. This is the whole visual feedback system —
   * the user should be able to see at a glance which answers they need to check.
   */
  JF.markFilled = function markFilled(el, fill) {
    if (!el) return;
    const target = el.type === 'radio' || el.type === 'checkbox' ? (el.closest('label, fieldset') || el) : el;
    target.classList.add('jf-filled');
    if (fill?.needsReview) target.classList.add('jf-review');
    if (fill?.via === 'ai') target.classList.add('jf-ai');

    target.addEventListener('input', () => {
      target.classList.remove('jf-filled', 'jf-review', 'jf-ai');
    }, { once: true });
  };

  /**
   * A keystroke is the one unambiguous signal that a value is the user's. Marking
   * on `beforeinput`/`keydown` (which only a real key press produces — dispatched
   * `input` events do not) means an automatic re-scan can never claim the field
   * back, however many times the page re-renders around it.
   */
  function markUserEdited(ev) {
    if (!ev.isTrusted) return;
    const el = ev.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.dataset.jfUserEdited = '1';
      el.classList.remove('jf-filled', 'jf-review', 'jf-ai');
    }
  }
  document.addEventListener('keydown', markUserEdited, true);
  document.addEventListener('paste', markUserEdited, true);

  const ERROR_RE = /required|invalid|must have|cannot be|not valid|enter a/i;
  const ERROR_SEL = [
    '[data-automation-id="errorMessage"]',
    '[data-automation-id*="rror"]',
    '[role="alert"]',
    '.error-message', '[class*="errorMessage"]', '[class*="ErrorMessage"]',
  ].join(', ');

  /**
   * Did the page reject what we put in this field?
   *
   * Checked after the whole pass rather than per write, because a form validates
   * on submit or on blur of a later field — the error for First Name appears long
   * after First Name was filled.
   */
  JF.fieldError = function fieldError(el) {
    if (!el) return null;
    const invalid = el.getAttribute('aria-invalid') === 'true';

    // Prefer the form's own wording — "The field First Name is required and must
    // have a value" tells the user what to do; "the form rejected this" does not.
    const described = el.getAttribute('aria-describedby');
    if (described) {
      for (const id of described.split(/\s+/)) {
        const node = document.getElementById(id);
        const text = node?.textContent?.trim();
        if (text && (invalid || ERROR_RE.test(text))) return text.slice(0, 160);
      }
    }

    // Otherwise look inside this field's own wrapper, never the whole form —
    // an unrelated error elsewhere on the page is not this field's problem.
    let box = el.closest('[data-automation-id^="formField"]') || el.parentElement;
    for (let depth = 0; depth < 3 && box; depth++, box = box.parentElement) {
      if (box.querySelectorAll('input, select, textarea').length > 2) break;
      const err = box.querySelector(ERROR_SEL);
      if (err && JF.isVisible(err) && err.textContent.trim()) {
        return err.textContent.trim().slice(0, 160);
      }
    }

    return invalid ? 'The form rejected this value' : null;
  };

  /** Write it again, harder, for a field the page says is still empty. */
  JF.repairField = async function repairField(el, value) {
    if (!el) return false;
    focusFirst(el);
    await sleep(40);
    setNativeValue(el, '');
    fireEvents(el);
    await sleep(40);
    setNativeValue(el, String(value));
    JF.claim(el, String(value));
    fireEvents(el, { keys: true });
    await sleep(40);
    commitField(el);
    await sleep(120);
    return !JF.fieldError(el) && String(el.value) === String(value);
  };

  JF.commitField = commitField;
  JF.sleep = sleep;
  JF.setNativeValue = setNativeValue;
  JF.fireEvents = fireEvents;
})();
