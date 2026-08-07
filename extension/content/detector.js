/**
 * Field detection.
 *
 * Turns an arbitrary application page into a list of field descriptors the API can
 * reason about. Three problems dominate here and each gets explicit handling:
 *
 *   1. Labels are rarely in a <label for>. They are sibling divs, aria-labelledby
 *      chains, table cells, placeholder text, or nothing at all.
 *   2. Modern ATSs render comboboxes as div soup with role="combobox" and no <select>.
 *   3. Radios and checkboxes are individual inputs but semantically one question.
 */
(() => {
  const JF = (window.__JOBFILL__ = window.__JOBFILL__ || {});

  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);
  const SKIP_NAMES = /captcha|csrf|honeypot|utm_|^_|nonce|antiforgery/i;

  /* ---------------------------------------------------------- visibility -- */
  function isVisible(el) {
    if (!el.isConnected) return false;
    // File inputs are almost always visually hidden behind a styled button, so
    // they are exempt from the geometry check — otherwise we would never find them.
    if (el.type === 'file') return true;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    return true;
  }

  /* -------------------------------------------------------------- labels -- */
  function textOf(node) {
    if (!node) return '';
    return (node.innerText || node.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/[*✱]\s*$/, '')
      .replace(/\((required|optional)\)/gi, '')
      .trim()
      .slice(0, 300);
  }

  function labelFromAria(el) {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(textOf);
      if (parts.join(' ').trim()) return parts.join(' ').trim();
    }
    return el.getAttribute('aria-label')?.trim() || '';
  }

  function labelFromFor(el) {
    if (el.id) {
      const esc = window.CSS?.escape ? CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&');
      const lab = document.querySelector(`label[for="${esc}"]`);
      if (lab) return textOf(lab);
    }
    const wrapping = el.closest('label');
    if (wrapping) {
      // A wrapping label includes the control's own text; strip nested inputs first.
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
      return textOf(clone);
    }
    return '';
  }

  const CONTROL_SEL = 'input:not([type=hidden]), select, textarea, [role="combobox"], [contenteditable="true"]';
  const LABELISH = 'label, legend, dt, th, .label, [class*="label"], [class*="Label"]';

  /**
   * Walk up a few levels looking for the *nearest* preceding text that reads like
   * a label.
   *
   * The ordering matters more than it looks. `querySelectorAll` returns document
   * order, so taking the first preceding hit returns the element furthest from the
   * input — typically a section heading or, worse, a div wrapping the previous
   * field and its value. Scanning the candidates in reverse takes the closest one,
   * which is the one a human would read as the label.
   */
  function labelFromProximity(el) {
    let node = el;
    for (let depth = 0; depth < 5 && node?.parentElement; depth++) {
      node = node.parentElement;
      const controls = node.querySelectorAll(CONTROL_SEL);
      if (controls.length > 1 && depth > 0) break;

      // `td` matters here: Taleo, iCIMS and a lot of older career pages lay the form
      // out as a table, where the label is simply the cell to the left.
      const cands = node.querySelectorAll(`${LABELISH}, td, p, span, div`);
      for (let i = cands.length - 1; i >= 0; i--) {
        const cand = cands[i];
        if (cand.contains(el)) continue;
        // A candidate that holds a control of its own is a field wrapper, not a
        // label — its text is some other field's *value*.
        if (cand.querySelector(CONTROL_SEL)) continue;
        if (!(cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        const t = textOf(cand);
        if (t.length >= 2 && t.length <= 200) return t;
      }
    }
    return '';
  }

  function labelFromTableCell(el) {
    const cell = el.closest('td, th');
    const prev = cell?.previousElementSibling;
    return prev ? textOf(prev) : '';
  }

  /**
   * Precedence is deliberate. `<label for>` and `aria-labelledby` are declared by
   * the page itself and point at exactly one control, so they outrank every
   * heuristic including the adapter's. Running the adapter first — as this used to
   * — let one platform quirk override ground truth on every field it touched.
   */
  function resolveLabel(el, adapter) {
    let label =
      labelFromFor(el) ||
      labelFromAria(el);

    if (!label && adapter?.labelFor) {
      try { label = adapter.labelFor(el) || ''; } catch { label = ''; }
    }

    label = label ||
      (adapter?.quirks?.tableLayout ? labelFromTableCell(el) : '') ||
      labelFromProximity(el) ||
      el.placeholder?.trim() ||
      el.title?.trim() ||
      JF.humanizeAutomationId(el.getAttribute('data-automation-id') || el.name || '');

    return adapter?.labelClean ? adapter.labelClean(label) : label;
  }

  /** The nearest fieldset legend or heading — gives the AI grouping context. */
  function resolveSection(el, adapter) {
    if (adapter?.sectionFor) {
      try { const custom = adapter.sectionFor(el); if (custom) return custom.slice(0, 120); } catch { /* keep going */ }
    }
    const legend = el.closest('fieldset')?.querySelector('legend');
    if (legend) return textOf(legend);

    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const h = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role="heading"]');
      if (h && !h.contains(el)) return textOf(h);
    }
    return '';
  }

  /* ------------------------------------------------ repeating sections -- */
  /**
   * Applications ask for the same six questions once per job and once per degree.
   * "Job Title" inside "Work Experience 2" is a different question from the one in
   * "Work Experience 1", and without an address for it every entry collapses onto
   * employment[0] — which is how the second job ends up showing the first job's
   * employer, and both degrees show the same university.
   *
   * Each field therefore carries `sectionKind` (what kind of repeating block it
   * sits in) and `sectionIndex` (which occurrence, zero-based).
   */
  const SECTION_KINDS = [
    ['employment', /work\s*experience|employment\s*(history|record)?|previous\s*(employer|position)|job\s*history|work\s*history/i],
    ['education', /education|school|university|college|academic|qualification/i],
    ['certification', /certificat|licen[cs]e|accreditation/i],
    ['language', /^languages?\b/i],
    ['reference', /reference/i],
    ['address', /^address|mailing\s*address|home\s*address/i],
    ['phone', /^phone|telephone|contact\s*number/i],
  ];

  function sectionKindOf(text) {
    if (!text) return '';
    for (const [kind, re] of SECTION_KINDS) if (re.test(text)) return kind;
    return '';
  }

  /** The element that wraps one repeating entry, not the whole form. */
  function sectionElOf(el) {
    return el.closest('div[role="group"], fieldset, [data-automation-id*="Section"], [class*="repeat"], [class*="entry"]') || null;
  }

  /**
   * Prefer the number the page itself prints ("Work Experience 2" → index 1).
   * Fall back to the order the blocks appear in, which is what unnumbered forms
   * (Greenhouse, Lever) give us.
   */
  function assignSectionIndexes(records) {
    const seen = new Map(); // kind -> [containers, in document order]
    for (const r of records) {
      if (!r.sectionKind) continue;
      const list = seen.get(r.sectionKind) || [];
      const container = r.sectionEl || r.el;
      let idx = list.indexOf(container);
      if (idx === -1) { list.push(container); idx = list.length - 1; seen.set(r.sectionKind, list); }

      const printed = /(\d+)\s*$/.exec(r.sectionText || '');
      r.sectionIndex = printed ? Math.max(0, Number(printed[1]) - 1) : idx;
    }
  }

  /** Helper/description text that often carries the word limit or format hint. */
  function resolveDescription(el) {
    const describedBy = el.getAttribute('aria-describedby');
    if (describedBy) {
      const t = describedBy.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(' ');
      if (t) return t.slice(0, 240);
    }
    const sib = el.parentElement?.querySelector('.help-text, .description, [class*="hint"], [class*="helper"], small');
    return sib && !sib.contains(el) ? textOf(sib).slice(0, 240) : '';
  }

  /* ------------------------------------------------------------ selector -- */
  /**
   * How many elements share each id / name / automation-id, counted in a single
   * sweep. Asking `document.querySelectorAll` per candidate attribute meant three
   * whole-document queries for every field on the page — around 180 of them on a
   * 60-field Workday step, repeated on every re-scan. One sweep answers all of it.
   */
  let uniq = { id: new Map(), name: new Map(), auto: new Map() };

  function indexAttributes() {
    const id = new Map(); const name = new Map(); const auto = new Map();
    const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
    for (const el of document.querySelectorAll('[id],[name],[data-automation-id]')) {
      bump(id, el.id);
      bump(name, el.getAttribute('name'));
      bump(auto, el.getAttribute('data-automation-id'));
    }
    uniq = { id, name, auto };
  }

  /** A selector that survives re-render. Prefers stable attributes over nth-child. */
  function buildSelector(el) {
    if (el.id && !/^\d/.test(el.id) && uniq.id.get(el.id) === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const auto = el.getAttribute('data-automation-id');
    if (auto && uniq.auto.get(auto) === 1) {
      return `[data-automation-id="${auto}"]`;
    }
    if (el.name && uniq.name.get(el.name) === 1) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    }

    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && path.length < 6) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      path.unshift(part);
      if (node.id) { path.unshift(`#${CSS.escape(node.id)}`); break; }
      node = parent;
    }
    return path.join(' > ');
  }

  /* ------------------------------------------------------- classification */
  function classify(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return el.multiple ? 'multiselect' : 'select';
    if (el.isContentEditable) return 'richtext';

    const role = el.getAttribute('role');
    if (role === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox') return 'combobox';

    const type = (el.type || 'text').toLowerCase();
    if (type === 'file') return 'file';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'date' || type === 'month' || type === 'week') return 'date';
    if (['text', 'email', 'tel', 'url', 'number', 'search', 'password'].includes(type)) {
      // A text input backed by a datalist or an autocomplete listbox behaves like a combobox.
      if (el.getAttribute('list') || el.getAttribute('aria-autocomplete')) return 'combobox';
      return 'text';
    }
    return 'text';
  }

  const PLACEHOLDER_OPTION = /^(select|choose|please select|--|\s*$)/i;

  /**
   * The choices a control offers.
   *
   * A `<select>` hands them over; a custom combobox does not, and returning an
   * empty list for those meant the planner was answering "Country" and "How Did
   * You Hear About Us?" with no idea what it was allowed to say — so it invented
   * wording no option matched and the field stayed blank. Where the listbox is
   * already in the DOM (Workday renders it collapsed, not absent) we can read it
   * without opening anything.
   */
  function readOptions(el, control) {
    if (control === 'select' || control === 'multiselect') {
      return [...el.options]
        .filter((o) => o.value !== '' || o.textContent.trim())
        .map((o) => ({ value: o.value, label: textOf(o) }))
        .filter((o) => o.label && !PLACEHOLDER_OPTION.test(o.label));
    }

    if (el.getAttribute('list')) {
      const dl = document.getElementById(el.getAttribute('list'));
      if (dl) return [...dl.options].map((o) => ({ value: o.value, label: o.label || o.value }));
    }

    if (control === 'combobox') {
      const box = ownedListbox(el);
      if (box) {
        const found = [...box.querySelectorAll('[role="option"], li')]
          .map((o) => ({ value: o.getAttribute('data-value') || textOf(o), label: textOf(o) }))
          .filter((o) => o.label && !PLACEHOLDER_OPTION.test(o.label));
        // A very long list is a country picker; the first 200 are plenty for the
        // planner to see the shape without bloating the request.
        if (found.length) return found.slice(0, 200);
      }
      // Some tenants keep a real <select> behind the custom widget.
      const shadowSelect = el.closest('[data-automation-id], .field, div')?.querySelector('select');
      if (shadowSelect?.options?.length) {
        return [...shadowSelect.options]
          .map((o) => ({ value: o.value, label: textOf(o) }))
          .filter((o) => o.label && !PLACEHOLDER_OPTION.test(o.label));
      }
    }
    return [];
  }

  /** The listbox a combobox declares as its own, whether or not it is showing. */
  function ownedListbox(el) {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (id) {
      const byId = document.getElementById(id);
      if (byId) return byId;
    }
    const wrap = el.closest('[role="combobox"]') || el.parentElement;
    return wrap?.querySelector('[role="listbox"]') || null;
  }

  /** Format hints let the filler write "MM/DD/YYYY" pages correctly. */
  function formatHint(el) {
    const p = el.placeholder || '';
    const m = p.match(/(?:dd|mm|yyyy|yy)[\/\-.](?:dd|mm|yyyy|yy)[\/\-.](?:dd|mm|yyyy|yy)/i);
    if (m) return m[0].toUpperCase();
    if (el.pattern) return `pattern:${el.pattern}`;
    return '';
  }

  /* ----------------------------------------------------------- traversal -- */
  /** Collect elements across shadow roots, which Ashby and several SPAs use. */
  function deepQuery(root, selector) {
    const out = [];
    const walk = (node) => {
      if (!node?.querySelectorAll) return;
      out.push(...node.querySelectorAll(selector));

      // Shadow hosts are rare; a TreeWalker finds them without a second full
      // `querySelectorAll('*')` pass over every element in the subtree.
      const NF = window.NodeFilter;
      const walker = document.createTreeWalker(node, NF.SHOW_ELEMENT, {
        acceptNode: (el) => (el.shadowRoot ? NF.FILTER_ACCEPT : NF.FILTER_SKIP),
      });
      const hosts = [];
      while (walker.nextNode()) hosts.push(walker.currentNode);
      for (const host of hosts) walk(host.shadowRoot);
    };
    walk(root);
    return out;
  }

  const SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable="true"]',
    '[role="combobox"]',
    '[role="textbox"]',
  ].join(',');

  /**
   * Detect every fillable field under the adapter's form root.
   * @returns {{adapter:object, fields:Array, page:object}}
   */
  let cache = null;
  const CACHE_MS = 1200;

  JF.detectFields = function detectFields(opts = {}) {
    // Detection is the expensive half of a fill and several callers ask for it in
    // quick succession (scan, plan, then the observer). A short-lived cache makes
    // the repeats free; anything that must see the current DOM passes `force`.
    if (!opts.force && cache && Date.now() - cache.at < CACHE_MS && cache.href === location.href) {
      return cache.result;
    }

    const adapter = JF.detectAdapter();
    const root = adapter.root() || document.body;
    indexAttributes();

    const raw = deepQuery(root, SELECTOR).filter((el) => {
      if (SKIP_TYPES.has((el.type || '').toLowerCase())) return false;
      if (SKIP_NAMES.test(el.name || el.id || '')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return isVisible(el);
    });

    const fields = [];
    const records = [];
    const radioGroups = new Map();
    let counter = 0;

    for (const el of raw) {
      const control = classify(el);

      // Radios sharing a name are one question with N options, not N questions.
      if (control === 'radio') {
        const group = el.closest('fieldset, [role="radiogroup"]');
        // The legend IS the question. It has to be checked before the proximity
        // walk, which would otherwise wander off and grab an earlier field's label.
        const legend = group?.querySelector('legend, [role="heading"], [class*="label"]');
        const groupLabel = (legend && !legend.contains(el) ? textOf(legend) : '')
          || resolveLabel(group || el.parentElement, adapter)
          || resolveSection(el, adapter);

        const key = el.name || groupLabel;
        if (!radioGroups.has(key)) {
          radioGroups.set(key, {
            uid: `f${counter++}`,
            control: 'radio',
            type: 'radio',
            name: el.name,
            selector: buildSelector(el),
            groupKey: key,
            label: groupLabel,
            section: resolveSection(el, adapter),
            required: el.required,
            options: [],
          });
        }
        const g = radioGroups.get(key);
        g.options.push({
          value: el.value,
          label: labelFromFor(el) || labelFromAria(el) || el.value,
          selector: buildSelector(el),
        });
        continue;
      }

      const label = resolveLabel(el, adapter);
      const sectionText = resolveSection(el, adapter);
      const opts = readOptions(el, control);
      const field = {
        uid: `f${counter++}`,
        selector: buildSelector(el),
        control,
        type: (el.type || el.tagName).toLowerCase(),
        tag: el.tagName.toLowerCase(),
        name: el.name || '',
        id: el.id || '',
        label,
        ariaLabel: labelFromAria(el),
        placeholder: el.placeholder || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        section: sectionText,
        sectionKind: sectionKindOf(sectionText),
        sectionIndex: 0,
        description: resolveDescription(el),
        required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
        multiple: Boolean(el.multiple),
        formatHint: formatHint(el),
        currentValue: control === 'checkbox' ? el.checked : (el.value || ''),
        options: opts,
        // A combobox whose list we could not read still needs an answer — the
        // filler matches it against the live options once the menu opens, so the
        // planner should give the plain human value rather than stay silent.
        optionsUnknown: control === 'combobox' && !opts.length,
        // Isolated checkboxes are consent/agreement toggles; the planner treats them differently.
        isConsent: control === 'checkbox' && /agree|consent|terms|privacy|acknowledge|certify/i.test(label),
      };

      // Skip fields the user already filled — never clobber their own typing.
      // `jfUserEdited` is set by a trusted keystroke, so a field stays theirs even
      // after they clear it and start again.
      if (el.dataset?.jfUserEdited === '1') field.prefilled = true;
      else if (field.currentValue && field.control !== 'checkbox' && String(field.currentValue).trim()) {
        field.prefilled = true;
      }

      records.push({ ...field, el, sectionEl: sectionElOf(el), sectionText, sectionKind: field.sectionKind });
      fields.push(field);
    }

    // Indexes need the whole document-ordered set, so they are assigned in one
    // pass once every field is known rather than guessed per field.
    assignSectionIndexes(records);
    for (const r of records) {
      const f = fields.find((x) => x.uid === r.uid);
      if (f) f.sectionIndex = r.sectionIndex ?? 0;
    }

    fields.push(...radioGroups.values());
    fields.sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)));

    const result = {
      adapter: { id: adapter.id, name: adapter.name, quirks: adapter.quirks },
      fields,
      page: {
        url: location.href,
        title: document.title,
        ats: adapter.id,
        company: guessCompany(),
        role: guessRole(),
      },
    };
    cache = { at: Date.now(), href: location.href, result };
    return result;
  };

  function guessCompany() {
    const meta = document.querySelector('meta[property="og:site_name"]')?.content;
    if (meta) return meta.trim();
    const known = document.querySelector('[class*="company-name"], [data-testid*="company"], .posting-categories .company')?.textContent;
    if (known?.trim()) return known.trim().slice(0, 80);
    return location.hostname.replace(/^(www|jobs|boards|careers|apply)\./, '').split('.')[0];
  }

  function guessRole() {
    const h1 = document.querySelector('h1, .posting-headline h2, [class*="job-title"], [data-automation-id*="jobTitle"]');
    return h1 ? textOf(h1).slice(0, 120) : (document.title || '').split(/[|\-–]/)[0].trim().slice(0, 120);
  }

  JF.deepQuery = deepQuery;
  JF.isVisible = isVisible;
  JF.textOf = textOf;
})();
