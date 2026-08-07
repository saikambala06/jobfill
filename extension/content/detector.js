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

  /**
   * Walk up a few levels looking for the nearest preceding text node that reads
   * like a label. Stops as soon as the container holds more than one control,
   * which is what prevents a section heading being applied to every field under it.
   */
  function labelFromProximity(el) {
    let node = el;
    for (let depth = 0; depth < 5 && node?.parentElement; depth++) {
      node = node.parentElement;
      const controls = node.querySelectorAll('input:not([type=hidden]), select, textarea');
      if (controls.length > 1 && depth > 0) break;

      // `td` matters here: Taleo, iCIMS and a lot of older career pages lay the form
      // out as a table, where the label is simply the cell to the left.
      for (const cand of node.querySelectorAll('label, .label, [class*="label"], legend, dt, th, td, p, span, div')) {
        if (cand.contains(el)) continue;
        if (cand.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          const t = textOf(cand);
          if (t.length >= 2 && t.length <= 200) return t;
        }
      }
    }
    return '';
  }

  function labelFromTableCell(el) {
    const cell = el.closest('td, th');
    const prev = cell?.previousElementSibling;
    return prev ? textOf(prev) : '';
  }

  function resolveLabel(el, adapter) {
    if (adapter?.labelFor) {
      const custom = adapter.labelFor(el);
      if (custom) return adapter.labelClean ? adapter.labelClean(custom) : custom;
    }
    const label =
      labelFromFor(el) ||
      labelFromAria(el) ||
      (adapter?.quirks?.tableLayout ? labelFromTableCell(el) : '') ||
      labelFromProximity(el) ||
      el.placeholder?.trim() ||
      el.title?.trim() ||
      JF.humanizeAutomationId(el.getAttribute('data-automation-id') || el.name || '');

    return adapter?.labelClean ? adapter.labelClean(label) : label;
  }

  /** The nearest fieldset legend or heading — gives the AI grouping context. */
  function resolveSection(el) {
    const legend = el.closest('fieldset')?.querySelector('legend');
    if (legend) return textOf(legend);

    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const h = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend, :scope > [role="heading"]');
      if (h && !h.contains(el)) return textOf(h);
    }
    return '';
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
  /** A selector that survives re-render. Prefers stable attributes over nth-child. */
  function buildSelector(el) {
    if (el.id && !/^\d/.test(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const auto = el.getAttribute('data-automation-id');
    if (auto && document.querySelectorAll(`[data-automation-id="${auto}"]`).length === 1) {
      return `[data-automation-id="${auto}"]`;
    }
    if (el.name) {
      const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
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

  function readOptions(el, control) {
    if (control === 'select' || control === 'multiselect') {
      return [...el.options]
        .filter((o) => o.value !== '' || o.textContent.trim())
        .map((o) => ({ value: o.value, label: textOf(o) }))
        .filter((o) => o.label && !/^(select|choose|please select|--)/i.test(o.label));
    }
    if (el.getAttribute('list')) {
      const dl = document.getElementById(el.getAttribute('list'));
      if (dl) return [...dl.options].map((o) => ({ value: o.value, label: o.label || o.value }));
    }
    return [];
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
      if (!node) return;
      if (node.querySelectorAll) out.push(...node.querySelectorAll(selector));
      const treeWalker = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (const el of treeWalker) if (el.shadowRoot) walk(el.shadowRoot);
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
  JF.detectFields = function detectFields() {
    const adapter = JF.detectAdapter();
    const root = adapter.root() || document.body;

    const raw = deepQuery(root, SELECTOR).filter((el) => {
      if (SKIP_TYPES.has((el.type || '').toLowerCase())) return false;
      if (SKIP_NAMES.test(el.name || el.id || '')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return isVisible(el);
    });

    const fields = [];
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
          || resolveSection(el);

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
            section: resolveSection(el),
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
        section: resolveSection(el),
        description: resolveDescription(el),
        required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
        multiple: Boolean(el.multiple),
        formatHint: formatHint(el),
        currentValue: control === 'checkbox' ? el.checked : (el.value || ''),
        options: readOptions(el, control),
        // Isolated checkboxes are consent/agreement toggles; the planner treats them differently.
        isConsent: control === 'checkbox' && /agree|consent|terms|privacy|acknowledge|certify/i.test(label),
      };

      // Skip fields the user already filled — never clobber their own typing.
      if (field.currentValue && field.control !== 'checkbox' && String(field.currentValue).trim()) {
        field.prefilled = true;
      }

      fields.push(field);
    }

    fields.push(...radioGroups.values());
    fields.sort((a, b) => Number(a.uid.slice(1)) - Number(b.uid.slice(1)));

    return {
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
