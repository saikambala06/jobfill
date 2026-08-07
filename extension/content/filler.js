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

  /* --------------------------------------------------------- native set -- */
  const nativeSetters = {
    input: Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set,
    textarea: Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set,
    select: Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set,
  };

  function setNativeValue(el, value) {
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
    el.dispatchEvent(new Event('input', opts));
    el.dispatchEvent(new Event('change', opts));
    if (keys) el.dispatchEvent(new KeyboardEvent('keyup', { ...opts, key: 'a' }));
  }

  function focusFirst(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus({ preventScroll: true });
    } catch { /* detached nodes are non-fatal */ }
  }

  /* -------------------------------------------------------------- text --- */
  async function fillText(el, value) {
    focusFirst(el);
    setNativeValue(el, '');
    fireEvents(el);
    await sleep(10);
    setNativeValue(el, String(value));
    fireEvents(el, { keys: true });
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
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
  async function fillSelect(el, value) {
    const target = JF.normalize(String(value));
    let chosen = [...el.options].find((o) => o.value === value)
      || [...el.options].find((o) => JF.normalize(o.textContent) === target)
      || [...el.options].find((o) => JF.normalize(o.textContent).includes(target) || target.includes(JF.normalize(o.textContent)));

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
      if (label === target || el.value === value || label.includes(target) || target.includes(label)) {
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

    const options = await waitForOptions(quirks.slowRender || 400);
    if (!options.length) {
      // Some comboboxes are really text inputs with a suggestion layer; the typed
      // value alone is a valid outcome there.
      return typeable && Boolean(el.value);
    }

    let best = null;
    for (const opt of options) {
      const text = JF.normalize(opt.innerText || opt.textContent || '');
      if (!text) continue;
      let score = 0;
      if (text === target) score = 1;
      else if (text.startsWith(target)) score = 0.9;
      else if (text.includes(target) || target.includes(text)) score = 0.75;
      if (score > (best?.score ?? 0)) best = { el: opt, score };
    }

    if (best && best.score >= 0.7) {
      best.el.scrollIntoView({ block: 'nearest' });
      best.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      best.el.click();
      await sleep(120);
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }

    // Nothing matched — close the menu so we don't leave the page in a weird state.
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    return false;
  }

  async function waitForOptions(timeout) {
    const sel = '[role="option"], [role="listbox"] li, .select2-results__option, [class*="option"][id], li[data-value]';
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = [...document.querySelectorAll(sel)].filter((o) => JF.isVisible(o));
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

  JF.sleep = sleep;
  JF.setNativeValue = setNativeValue;
  JF.fireEvents = fireEvents;
})();
