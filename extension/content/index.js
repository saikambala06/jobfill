/**
 * Content-script orchestrator.
 *
 * Owns the sequence: detect → plan (server) → fill → review → remember.
 * Everything that touches the network goes through the service worker, so the
 * bearer token never has to exist inside a page's context.
 */
(() => {
  const JF = (window.__JOBFILL__ = window.__JOBFILL__ || {});
  if (JF.__booted) return;
  JF.__booted = true;

  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });

  let lastDetection = null;
  let lastPlan = null;
  let running = false;
  let lastRunAt = 0;
  let lastStepSignature = '';

  /**
   * The last moment the user pressed a key anywhere on the page. Every automatic
   * re-fill defers to it: a form that re-renders as you type looks exactly like a
   * form that advanced to a new step, and the only thing that tells them apart is
   * whether a human is currently at the keyboard.
   */
  let lastKeyAt = 0;
  const TYPING_GRACE_MS = 4000;
  document.addEventListener('keydown', (e) => { if (e.isTrusted) lastKeyAt = Date.now(); }, true);
  document.addEventListener('paste', (e) => { if (e.isTrusted) lastKeyAt = Date.now(); }, true);

  const userIsBusy = () => {
    if (Date.now() - lastKeyAt < TYPING_GRACE_MS) return true;
    const a = document.activeElement;
    return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable));
  };

  /** A cheap fingerprint of "which questions are on screen right now". */
  const stepSignature = (fields) => fields.map((f) => f.selector).sort().join('|');

  /* --------------------------------------------------------------- run --- */
  async function run(opts = {}) {
    if (running) return;
    running = true;
    try { await doRun(opts); } finally { running = false; lastRunAt = Date.now(); }
  }

  async function doRun(opts = {}) {
    const started = Date.now();
    const detection = JF.detectFields({ force: true });
    lastDetection = detection;
    lastStepSignature = stepSignature(detection.fields);

    if (!detection.fields.length) {
      JF.overlay.show({
        title: 'No form found here',
        rows: [], stats: { detected: 0 },
        warning: 'Open the application page itself, then run the fill again.',
      });
      return;
    }

    JF.overlay.show({
      title: `Filling on ${detection.adapter.name}`,
      rows: [],
      unresolved: [],
      warning: null,
      stats: { detected: detection.fields.length },
      page: detection.page,
    });

    // Prefilled fields stay untouched — the user's own typing always wins.
    const fillable = detection.fields.filter((f) => !f.prefilled);

    const res = await send('PLAN_FILL', {
      fields: fillable,
      page: detection.page,
      resumeId: opts.resumeId,
      options: opts,
    });

    if (!res?.ok) {
      JF.overlay.update({
        warning: res?.error || 'Could not reach the fill service. Check you are signed in.',
        stats: { detected: detection.fields.length },
      });
      return;
    }

    lastPlan = res.data;
    const { fills, document: doc, stats, unresolved, warning } = res.data;
    const byUid = new Map(detection.fields.map((f) => [f.uid, f]));

    // Fetch the résumé bytes only when the page actually has a file input.
    let fileDoc = null;
    if (doc && fills.some((f) => f.kind === 'file')) {
      const fileRes = await send('GET_DOCUMENT', { id: doc.id });
      if (fileRes?.ok) fileDoc = fileRes.data;
    }

    const results = [];
    for (let i = 0; i < fills.length; i++) {
      const fill = fills[i];
      const field = byUid.get(fill.uid);
      if (!field) continue;

      const result = await JF.applyFill(fill, field, {
        document: fileDoc,
        quirks: detection.adapter.quirks,
      });
      results.push(result);
      if (result.ok) JF.overlay.addRow({ ...result, uid: fill.uid, value: fill.label ?? fill.value });
      JF.overlay.progress(i + 1, fills.length);

      // Only the widgets that actually re-render need a beat between writes.
      // Pausing after every plain text box cost roughly a second per twelve fields
      // and bought nothing, which is most of where the fill felt slow.
      const needsBeat = ['combobox', 'select', 'multiselect', 'date', 'file'].includes(field.control);
      if (needsBeat) await JF.sleep(detection.adapter.quirks?.slowRender ? 90 : 35);
    }

    const filled = results.filter((r) => r.ok).length;
    JF.overlay.update({
      title: `${filled} of ${detection.fields.length} filled`,
      unresolved,
      warning,
      stats: { ...stats, detected: detection.fields.length, needsReview: results.filter((r) => r.ok && r.needsReview).length },
    });

    send('RECORD_FILL', {
      page: detection.page,
      stats: { ...stats, needsReview: results.filter((r) => r.needsReview).length },
      resumeId: doc?.id,
      durationMs: Date.now() - started,
    });
  }

  /* ------------------------------------------------------ save answers --- */
  /**
   * Read the form back as the user left it — including their corrections — and
   * store it. Capturing after edits is the point: the corrected answer is the one
   * worth reusing next time.
   */
  async function saveAnswers() {
    const detection = JF.detectFields({ force: true });
    const answers = [];

    for (const field of detection.fields) {
      const question = field.label || field.ariaLabel || field.placeholder;
      if (!question || question.length < 3) continue;
      if (field.control === 'file') continue;
      if (field.control === 'checkbox' && !field.isConsent) continue;

      let value = '';
      let chosen = [];
      if (field.control === 'radio') {
        for (const opt of field.options || []) {
          const el = document.querySelector(opt.selector);
          if (el?.checked) { value = opt.label; chosen = [opt.label]; break; }
        }
      } else {
        const el = document.querySelector(field.selector);
        if (!el) continue;
        value = el.isContentEditable ? el.textContent : el.value;
        if (el.tagName === 'SELECT' && el.selectedOptions?.length) {
          chosen = [...el.selectedOptions].map((o) => o.textContent.trim()).filter(Boolean);
          value = chosen.join(', ');
        }
      }

      // The section is part of the question's identity. "Job Title" under Work
      // Experience 1 and under Work Experience 2 are two different answers, and
      // storing them under one key is why a saved answer came back attached to the
      // wrong row the next time round.
      const scope = field.sectionKind ? `${field.sectionKind}:${field.sectionIndex ?? 0}` : '';
      const filled = String(value ?? '').trim();

      if (filled) {
        answers.push({
          question, scope, answer: filled, control: field.control,
          chosenOptions: chosen, source: 'user', skipped: false,
        });
      } else {
        // A blank at save time is a decision, not an omission. Recording it stops
        // the planner and the AI from helpfully inventing something next time.
        answers.push({
          question, scope, answer: '', control: field.control,
          chosenOptions: [], source: 'user', skipped: true,
        });
      }
    }

    if (!answers.length) {
      JF.overlay.update({ warning: 'Nothing to save yet — fill some answers first.' });
      return;
    }

    const kept = answers.filter((a) => !a.skipped).length;
    const blanks = answers.length - kept;
    const res = await send('SAVE_ANSWERS', { answers, site: location.hostname });
    JF.overlay.update({
      warning: res?.ok
        ? `Saved ${kept} answer${kept === 1 ? '' : 's'}${blanks ? ` and ${blanks} field${blanks === 1 ? '' : 's'} you chose to leave blank` : ''}. They will fill exactly this way next time.`
        : (res?.error || 'Could not save your answers.'),
    });
  }

  /* -------------------------------------------------------- regenerate --- */
  async function regenerate(uid, button) {
    const field = lastDetection?.fields.find((f) => f.uid === uid);
    if (!field) return;

    button.disabled = true;
    button.textContent = 'Writing…';
    const res = await send('DRAFT_ANSWER', {
      question: field.label,
      maxWords: field.maxLength ? Math.floor(field.maxLength / 6) : undefined,
      context: { company: lastDetection.page.company, role: lastDetection.page.role },
    });

    if (res?.ok) {
      await JF.applyFill({ uid, value: res.data.answer, via: 'ai', needsReview: true }, field, {});
      JF.overlay.addRow({ uid, ok: true, label: field.label, value: res.data.answer, via: 'ai', needsReview: true });
    } else {
      button.textContent = 'Retry';
      button.disabled = false;
    }
  }

  JF.overlay.onAction = (action, button, arg) => {
    if (action === 'fill' || action === 'rescan') run();
    if (action === 'save') saveAnswers();
    if (action === 'regenerate') regenerate(arg, button);
  };

  /* ------------------------------------------------------------ wiring --- */
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'RUN_AUTOFILL') { run(msg.payload || {}); respond({ ok: true }); }
    if (msg.type === 'SCAN_ONLY') {
      const d = JF.detectFields();
      respond({ ok: true, data: { count: d.fields.length, ats: d.adapter.name, page: d.page } });
    }
    if (msg.type === 'SAVE_ANSWERS_NOW') { saveAnswers(); respond({ ok: true }); }
    if (msg.type === 'TOGGLE_PANEL') { JF.overlay.toggle(msg.payload || {}); respond({ ok: true, open: JF.overlay.isOpen() }); }
    if (msg.type === 'OPEN_PANEL') { JF.overlay.open(msg.payload || {}); respond({ ok: true }); }
    return true;
  });

  /**
   * Multi-step flows (Workday, LinkedIn Easy Apply, Indeed) swap the entire field
   * set on "Next" without a navigation. Watching for a burst of new inputs is how
   * we notice, and it is throttled so a chatty SPA cannot spin us.
   */
  let debounce;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const { autoFillNewSteps } = await chrome.storage.local.get('autoFillNewSteps');
      if (!autoFillNewSteps || !lastPlan) return;

      // Four independent reasons to stand down. The old version had none of them
      // and re-ran on any burst of DOM churn — including the churn a React form
      // generates while you are typing into it, which is how a half-typed answer
      // got overwritten mid-word.
      if (running) return;
      if (userIsBusy()) return;
      if (Date.now() - lastRunAt < 5000) return;

      const now = JF.detectFields({ force: true });
      const signature = stepSignature(now.fields);
      if (signature === lastStepSignature) return;   // same questions, just a re-render

      // A genuine new step brings questions that were not on the previous one.
      const before = new Set((lastDetection?.fields || []).map((f) => f.selector));
      const brandNew = now.fields.filter((f) => !before.has(f.selector) && !f.prefilled);
      if (brandNew.length < 3) return;

      run({ silent: true });
    }, 900);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Announce readiness so the popup can enable its button without a round trip.
  chrome.runtime.sendMessage({
    type: 'PAGE_READY',
    payload: { url: location.href, ats: JF.detectAdapter().id },
  }).catch(() => {});
})();
