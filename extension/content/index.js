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

  /* --------------------------------------------------------------- run --- */
  async function run(opts = {}) {
    const started = Date.now();
    const detection = JF.detectFields();
    lastDetection = detection;

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

      // Workday and SuccessFactors re-render between writes; a short beat keeps
      // us from typing into a node that is about to be replaced.
      await JF.sleep(detection.adapter.quirks?.slowRender ? 90 : 35);
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
    const detection = JF.detectFields();
    const answers = [];

    for (const field of detection.fields) {
      const question = field.label || field.ariaLabel || field.placeholder;
      if (!question || question.length < 8) continue;
      if (['file', 'checkbox'].includes(field.control) && !field.isConsent) continue;

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
          chosen = [...el.selectedOptions].map((o) => o.textContent.trim());
          value = chosen.join(', ');
        }
      }

      if (String(value || '').trim().length < 1) continue;
      answers.push({
        question, answer: String(value).trim(), control: field.control,
        chosenOptions: chosen, source: 'user',
      });
    }

    if (!answers.length) {
      JF.overlay.update({ warning: 'Nothing to save yet — fill some answers first.' });
      return;
    }

    const res = await send('SAVE_ANSWERS', { answers, site: location.hostname });
    JF.overlay.update({
      warning: res?.ok
        ? `Saved ${res.data.saved} answers. They will fill themselves next time.`
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
    if (action === 'rescan') run();
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

      const now = JF.detectFields();
      const fresh = now.fields.filter((f) => !f.prefilled).length;
      if (fresh >= 3 && now.fields.length !== lastDetection?.fields.length) run({ silent: true });
    }, 900);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Announce readiness so the popup can enable its button without a round trip.
  chrome.runtime.sendMessage({
    type: 'PAGE_READY',
    payload: { url: location.href, ats: JF.detectAdapter().id },
  }).catch(() => {});
})();
