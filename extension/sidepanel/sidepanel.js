/**
 * Side-panel controller.
 *
 * Docked beside the application rather than floating over it, so it stays open
 * through every step of the form. That changes two things versus a popup: the
 * panel outlives any single page, so it has to re-scan when the user switches tab
 * or the site navigates; and it can show the fill happening live, because it is
 * still on screen while the content script works.
 *
 * All network access is delegated to the service worker — the token never enters
 * a page's context.
 */

const $ = (id) => document.getElementById(id);
const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mode = 'login';
let formTab = null;
let rows = [];

/* ------------------------------------------------------- toolbar toggle -- */
/**
 * A live port to the service worker, which is how the toolbar icon knows whether
 * the panel is already open. There is no API to ask Chrome that, so the panel
 * answers it by existing: the port is held for exactly as long as the panel is on
 * screen, and the worker treats its disconnect as the close.
 *
 * The worker replies with whether this open should start clean — the third click
 * of the open → close → open-fresh cycle.
 */
let port = null;
let resolveBoot;
const bootState = new Promise((resolve) => { resolveBoot = resolve; });

function connect(windowId) {
  try {
    port = chrome.runtime.connect({ name: 'jobfill-panel' });
    port.postMessage({ type: 'PANEL_HELLO', windowId });
  } catch {
    // The extension was reloaded or updated underneath us. Nothing to reconnect
    // to, and retrying forever would just spin.
    port = null;
    resolveBoot({ fresh: false });
    return;
  }

  port.onMessage.addListener((msg) => {
    if (msg?.type === 'PANEL_BOOT') resolveBoot({ fresh: Boolean(msg.fresh) });
    // Second click on the toolbar icon. Closing ourselves is cleaner than any
    // workaround from the worker's side, which can only disable the panel and
    // hope.
    if (msg?.type === 'PANEL_CLOSE') window.close();
  });

  // A recycled worker must not be mistaken for a closed panel, or the next click
  // would open a second one instead of closing this.
  port.onDisconnect.addListener(() => { port = null; setTimeout(() => connect(windowId), 300); });
}

/**
 * Say goodbye properly.
 *
 * The worker cannot tell a panel that closed from a port that dropped under a
 * recycled worker, and guessing wrong in either direction is bad: guess "closed"
 * and a reconnecting panel wipes its own results mid-application; guess "alive"
 * and closing with Chrome's own X leaves the next open showing the last posting.
 * `pagehide` only fires when this document is genuinely going away, so it is the
 * one signal that means it.
 */
window.addEventListener('pagehide', () => {
  try { port?.postMessage({ type: 'PANEL_CLOSING' }); } catch { /* already gone */ }
});

/* ---------------------------------------------------------------- boot -- */
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && /^https?:/.test(tab.url || '') ? tab : null;
}

(async function boot() {
  const win = await chrome.windows.getCurrent().catch(() => null);
  connect(win?.id ?? chrome.windows?.WINDOW_ID_CURRENT ?? -2);

  formTab = await currentTab();

  const { apiBase } = await chrome.storage.local.get('apiBase');
  $('api-base').value = apiBase || '';

  // Don't hang the panel on the worker: if the reply is slow, boot as a resume.
  const state = await Promise.race([bootState, sleep(700).then(() => ({ fresh: false }))]);

  const { token } = await chrome.storage.local.get('token');
  if (token) showMain({ fresh: state.fresh }); else showAuth();
})();

/**
 * Reopening after a deliberate close means a new application, not a resumed one.
 * Anything describing the last page — the trace, the notes, the content script's
 * memory of what it planned — is discarded before the first scan, so nothing from
 * the previous posting can be read as belonging to this one.
 *
 * The page itself is deliberately left alone. Reloading it would take the user's
 * half-typed answers with it, which is a far worse outcome than a stale panel.
 */
async function startFresh() {
  clearResults();
  $('fill-note').hidden = true;
  $('detect').className = 'detect';
  $('detect-ats').textContent = 'Scanning…';
  $('detect-count').textContent = '—';
  $('detect-role').textContent = '—';
  await send('RESET_SESSION', { tabId: formTab?.id }).catch(() => {});
}

// The panel outlives the page it was opened on, so it follows the user around.
chrome.tabs.onActivated.addListener(async () => { formTab = await currentTab(); refreshPage(); });
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const tab = await currentTab();
  if (tab?.id !== tabId) return;
  formTab = tab;
  clearResults();
  refreshPage();
});

function refreshPage() {
  if (!$('main').hidden) scanPage();
}

function showAuth() {
  $('auth').hidden = false;
  $('main').hidden = true;
  $('email').focus();
}

async function showMain({ fresh = false } = {}) {
  $('auth').hidden = true;
  $('main').hidden = false;

  if (fresh) await startFresh();

  const { user, autoFillNewSteps } = await chrome.storage.local.get(['user', 'autoFillNewSteps']);
  const name = user?.name || 'Your profile';
  $('user-name').textContent = name;
  $('user-email').textContent = user?.email || '';
  $('menu-name').textContent = name;
  $('menu-email').textContent = user?.email || '';
  $('avatar-initials').textContent = initials(name || user?.email || '?');
  $('auto-steps').checked = Boolean(autoFillNewSteps);

  scanPage();
  loadResumes();
  loadProfile();
  loadStats();
}

/** "Vinitha N" → "VN"; an email falls back to its first letter. */
function initials(text) {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(text).slice(0, 2).toUpperCase();
}

/* ---------------------------------------------------------------- auth -- */
$('auth-toggle').onclick = () => {
  mode = mode === 'login' ? 'register' : 'login';
  $('name-field').hidden = mode === 'login';
  $('auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('auth-toggle').textContent = mode === 'login' ? 'Create an account instead' : 'I already have an account';
  $('password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('auth-error').hidden = true;
};

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('auth-submit');
  const err = $('auth-error');
  err.hidden = true;
  btn.disabled = true;
  btn.classList.add('busy');

  const res = await send(mode === 'login' ? 'LOGIN' : 'REGISTER', {
    email: $('email').value.trim(),
    password: $('password').value,
    name: $('name').value.trim() || undefined,
  });

  btn.disabled = false;
  btn.classList.remove('busy');

  if (res?.ok) showMain();
  else { err.textContent = res?.error || 'Could not sign you in.'; err.hidden = false; }
};

$('save-api').onclick = async () => {
  await send('SET_API_BASE', { apiBase: $('api-base').value.trim() });
  $('save-api').textContent = 'Address saved';
  setTimeout(() => { $('save-api').textContent = 'Save address'; }, 1600);
};

/* ------------------------------------------------------ account menu -- */
const menu = () => $('account-menu');

function closeMenu() {
  menu().hidden = true;
  $('account-btn').setAttribute('aria-expanded', 'false');
}

$('account-btn').onclick = (e) => {
  e.stopPropagation();
  const open = menu().hidden;
  menu().hidden = !open;
  $('account-btn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!e.target.closest('.account')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

$('menu-profile').onclick = () => { closeMenu(); openDashboard('/profile'); };
$('menu-settings').onclick = () => { closeMenu(); openDashboard('/settings'); };
$('logout').onclick = async () => { closeMenu(); await send('LOGOUT'); clearResults(); showAuth(); };

/* ---------------------------------------------------------- page scan -- */
/** Paint the detect box from a scan result. One place, so every path agrees. */
function applyDetection(data) {
  const found = Number(data?.count) > 0;
  $('detect').className = found ? 'detect found' : 'detect none';
  $('detect-ats').textContent = found ? data.ats : (data?.ats || 'No form on this page');
  $('detect-count').textContent = `${data?.count ?? 0} detected`;
  $('detect-role').textContent = data?.page?.role || data?.page?.company || '—';
  $('fill').disabled = !found;
  return found;
}

/**
 * Read the page.
 *
 * Two routes on purpose. Talking to the tab directly is the fast one, but a
 * step change on a single-page ATS can leave the tab without a listener — and
 * the old code read that silence as "not available here", so the panel gave up
 * on a page that was perfectly fillable. The worker can inject the content
 * script and ask again, so a failure of the first route is a reason to take the
 * second, not a reason to stop.
 */
async function scanPage() {
  try {
    if (!formTab) formTab = await currentTab();
    if (!formTab) throw new Error('no page');
    const res = await chrome.tabs.sendMessage(formTab.id, { type: 'SCAN_ONLY' });
    if (res?.ok) { applyDetection(res.data); return res.data; }
    throw new Error('no answer');
  } catch {
    const res = await send('RESCAN_TAB', { tabId: formTab?.id }).catch(() => null);
    if (res?.ok) { applyDetection(res.data); return res.data; }

    // Genuinely nothing to talk to: a chrome:// page, or a tab that pre-dates install.
    $('detect').className = 'detect none';
    $('detect-ats').textContent = 'Not available here';
    $('detect-count').textContent = '—';
    $('detect-role').textContent = 'Reload the page and try again';
    $('fill').disabled = true;
    return null;
  }
}

/* ------------------------------------------------------------ resumes -- */
async function loadResumes() {
  const res = await send('LIST_RESUMES');
  const sel = $('resume');
  sel.innerHTML = '';

  if (!res?.ok || !res.data.resumes.length) {
    sel.innerHTML = '<option value="">No résumé uploaded yet</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const r of res.data.resumes) {
    const opt = document.createElement('option');
    opt.value = r._id;
    opt.textContent = `${r.label}${r.isDefault ? ' — default' : ''}`;
    opt.selected = r.isDefault;
    sel.append(opt);
  }
}

/* ------------------------------------------------------------ profile -- */
async function loadProfile() {
  const res = await send('GET_PROFILE');
  if (!res?.ok) return;

  const pct = res.data.profile?.completeness ?? 0;
  $('completeness-pct').textContent = `${pct}%`;
  requestAnimationFrame(() => { $('completeness-bar').style.width = `${pct}%`; });

  const p = res.data.profile || {};
  const gaps = [];
  if (!p.identity?.phone) gaps.push('phone');
  if (!p.eligibility?.workAuthorized) gaps.push('work authorisation');
  if (!p.compensation?.expectedSalary) gaps.push('expected salary');
  if (!p.employment?.length) gaps.push('work history');
  if (!p.education?.length) gaps.push('education');

  $('completeness-hint').textContent = gaps.length
    ? `Add ${gaps.slice(0, 2).join(' and ')} to fill more fields.`
    : 'Your profile covers every common application field.';
}

async function loadStats() {
  const res = await send('GET_STATS');
  if (!res?.ok) return;
  // The completed count, not the row count: this is the number the user is
  // trying to grow, and the only one that moves when they confirm they are done.
  $('stat-apps').textContent = res.data.completedApplications
    ?? res.data.byStatus?.submitted
    ?? 0;
  $('stat-fields').textContent = res.data.fieldsFilled ?? 0;
  $('stat-answers').textContent = res.data.savedAnswers ?? 0;
}

/* --------------------------------------------------------------- fill -- */
$('fill').onclick = async () => {
  const btn = $('fill');
  const note = $('fill-note');
  clearResults();
  btn.classList.add('busy');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'Filling';
  note.hidden = true;

  try {
    if (!formTab) throw new Error('no page');
    await chrome.tabs.sendMessage(formTab.id, {
      type: 'RUN_AUTOFILL',
      payload: { resumeId: $('resume').value || undefined, surface: 'sidepanel' },
    });
  } catch {
    resetFillButton();
    note.textContent = 'Reload the page, then run the fill again.';
    note.className = 'note warn';
    note.hidden = false;
  }
};

function resetFillButton() {
  const btn = $('fill');
  btn.classList.remove('busy');
  btn.disabled = false;
  btn.querySelector('.btn-label').textContent = 'Fill this application';
}

$('save-answers').onclick = async () => {
  const btn = $('save-answers');
  if (!formTab) return;
  btn.disabled = true;
  await chrome.tabs.sendMessage(formTab.id, { type: 'SAVE_ANSWERS_NOW' }).catch(() => {});
};

async function openDashboard(path = '/') {
  const { apiBase, dashboardUrl } = await chrome.storage.local.get(['apiBase', 'dashboardUrl']);
  const base = (dashboardUrl || (apiBase || 'http://localhost:5173').replace(/:4000$/, ':5173')).replace(/\/+$/, '');
  chrome.tabs.create({ url: `${base}${path}` });
}
$('open-dashboard').onclick = () => openDashboard('/');

$('auto-steps').onchange = async (e) => {
  await chrome.storage.local.set({ autoFillNewSteps: e.target.checked });
};

/* --------------------------------------------------------- refresh ----- */
const dialog = {
  open() { $('scrim').hidden = false; $('dlg-ask').hidden = false; $('dlg-busy').hidden = true; $('dlg-ok').focus(); },
  busy(text) { $('dlg-ask').hidden = true; $('dlg-busy').hidden = false; $('dlg-busy-text').textContent = text; },
  close() { $('scrim').hidden = true; $('dlg-ask').hidden = false; $('dlg-busy').hidden = true; },
};

let finishing = false;

$('refresh').onclick = () => { if (!finishing) dialog.open(); };

// "Not yet" is a pure escape hatch: it closes the dialog and touches nothing —
// no recording, no re-scan, no clearing of the trace already on screen.
$('dlg-cancel').onclick = () => { if (!finishing) dialog.close(); };
$('scrim').onclick = (e) => { if (e.target === $('scrim') && !finishing) dialog.close(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('scrim').hidden && !finishing) dialog.close();
});

/**
 * Never let a promise hold the dialog open.
 *
 * The spinner used to be the last thing some users saw: an unreachable API or a
 * tab that stopped answering left `await` pending forever, and because the close
 * came after it, the dialog stayed up with its dots bouncing over stale numbers.
 * Every wait in this flow is now bounded and resolves to something the caller can
 * act on.
 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch((err) => ({ ok: false, error: err?.message })),
    sleep(ms).then(() => fallback),
  ]);
}

/**
 * Finish the application, then read the page again from scratch.
 *
 * Multi-page applications are the norm, so "done here" almost always means "now
 * show me what is next". The three states the user sees — recording, looking,
 * loading — are real stages, and the panel is repainted from a fresh scan at the
 * end of them whether or not a next step turned up. That last part is the fix:
 * previously a page with nothing new left the old step's field counts on screen,
 * so the panel described a form the user had already left.
 */
$('dlg-ok').onclick = async () => {
  if (finishing) return;
  finishing = true;
  $('dlg-ok').disabled = true;
  $('dlg-cancel').disabled = true;
  $('refresh').classList.add('spinning');
  $('refresh').disabled = true;

  let note = null;
  let warn = false;

  try {
    dialog.busy('Recording this application…');
    formTab = (await currentTab()) || formTab;

    const res = await withTimeout(
      send('COMPLETE_APPLICATION', { url: formTab?.url, title: formTab?.title }),
      12000,
      { ok: false, error: 'The server did not answer in time. Nothing was recorded.' },
    );

    if (!res?.ok) {
      note = res?.error || 'Could not record the application.';
      warn = true;
      return;
    }

    // Show the new total straight away rather than waiting on the stats refetch,
    // so pressing the button visibly does something.
    if (typeof res.data?.completed === 'number') {
      $('stat-apps').textContent = res.data.completed;
    }

    dialog.busy('Looking for the next step…');
    const next = await waitForNextStep();

    // Whatever the answer, the panel now describes the page as it is right now.
    dialog.busy('Loading the new fields…');
    clearResults();
    const seen = next || await scanPage();
    if (next) applyDetection(next);
    await loadStats();

    if (seen && Number(seen.count) > 0 && Number(seen.unfilled) > 0) {
      note = 'Application recorded — filling the next step now.';
      // Queued behind the dialog close so the user sees the trace, not the scrim.
      setTimeout(() => $('fill').click(), 0);
    } else {
      note = `Application recorded. You have completed ${res.data?.completed ?? 0}.`;
    }
  } catch (err) {
    note = err?.message || 'Something went wrong finishing up.';
    warn = true;
  } finally {
    // The close lives here so no failure above can strand the spinner.
    dialog.close();
    finishing = false;
    $('dlg-ok').disabled = false;
    $('dlg-cancel').disabled = false;
    $('refresh').classList.remove('spinning');
    $('refresh').disabled = false;
    if (note) showNote(note, warn);
  }
};

/**
 * Poll for a step with unfilled questions on it.
 *
 * Routed through the worker rather than straight at the tab: a Workday step
 * change can replace the document and take the content script's listener with
 * it, and the worker will re-inject before asking. The old direct call simply
 * threw into an empty catch on every attempt, so the loop always ran its full
 * length and always concluded there was nothing next.
 */
async function waitForNextStep(timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    await sleep(600);
    const res = await send('RESCAN_TAB', { tabId: formTab?.id }).catch(() => null);
    if (!res?.ok) continue;
    last = res.data;
    if (Number(last.count) > 0 && Number(last.unfilled) > 0) return last;
  }
  return null;
}

function showNote(text, warn = false) {
  const note = $('fill-note');
  note.textContent = text;
  note.className = warn ? 'note warn' : 'note';
  note.hidden = false;
}

/* ------------------------------------------------------- live results -- */
function clearResults() {
  rows = [];
  $('rows').innerHTML = '';
  $('results').hidden = true;
  $('trace-bar').style.width = '0%';
  $('m-filled').textContent = '0';
  $('m-review').textContent = '0';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderRows() {
  const filled = rows.filter((r) => r.ok);
  const review = filled.filter((r) => r.needsReview);
  const plain = filled.filter((r) => !r.needsReview);
  const skipped = rows.filter((r) => r.skipped);

  $('m-filled').textContent = filled.length;
  $('m-review').textContent = review.length;

  const block = (title, list) => (list.length
    ? `<div class="section-label">${title}</div>${list.map(rowHtml).join('')}`
    : '');

  $('rows').innerHTML =
    block('Check before you submit', review)
    + block('Filled from your profile', plain)
    + block('Left as you had them', skipped);
}

function rowHtml(r) {
  const tag = r.skipped ? 'skipped' : r.needsReview ? 'review' : (r.via || 'rule');
  const tagText = r.skipped ? 'yours'
    : r.needsReview ? 'check'
      : r.via === 'ai' ? 'AI' : r.via === 'memory' ? 'saved' : 'profile';
  const cls = r.skipped ? 'skipped' : r.needsReview ? 'review' : '';
  const body = r.skipped
    ? `<div class="v empty">${esc(r.reason || 'Left untouched')}</div>`
    : `<div class="v">${esc(String(r.value ?? '').slice(0, 240))}${String(r.value ?? '').length > 240 ? '…' : ''}</div>`;

  return `<div class="fill-row ${cls}">
    <div class="k"><span>${esc(r.label || 'Field')}</span><span class="tag ${tag}">${tagText}</span></div>
    ${body}
  </div>`;
}

/**
 * The content script narrates the fill as it goes. Because the panel is docked it
 * is still on screen to receive it, which is the whole reason for moving off a
 * popup: the user watches the form fill rather than finding out afterwards.
 */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'FILL_EVENT') return;
  const p = msg.payload || {};

  if (p.phase === 'start') {
    clearResults();
    $('results').hidden = false;
    $('m-detected').textContent = p.detected ?? '—';
    return;
  }

  if (p.phase === 'row') {
    rows = [...rows.filter((r) => r.uid !== p.row.uid), p.row];
    $('results').hidden = false;
    renderRows();
    if (p.total) $('trace-bar').style.width = `${Math.round((p.done / p.total) * 100)}%`;
    return;
  }

  if (p.phase === 'done') {
    resetFillButton();
    $('trace-bar').style.width = '100%';
    $('m-detected').textContent = p.detected ?? '—';
    if (p.warning) {
      showNote(p.warning, true);
    } else if (p.repaired) {
      // Worth saying out loud: these are fields the form rejected on the first
      // write and accepted on the second, which is otherwise invisible.
      showNote(`${p.repaired} field${p.repaired === 1 ? '' : 's'} needed a second pass before the form accepted ${p.repaired === 1 ? 'it' : 'them'}.`);
    }
    loadStats();
    return;
  }

  if (p.phase === 'saved') {
    const btn = $('save-answers');
    btn.disabled = false;
    btn.textContent = 'Answers saved';
    setTimeout(() => { btn.textContent = 'Save answers'; }, 1800);
    $('fill-note').textContent = p.message || '';
    $('fill-note').className = 'note';
    $('fill-note').hidden = !p.message;
    loadStats();
  }

  // The form moved to a new step without a page load. Refresh what we are
  // describing so the panel is never talking about the screen behind the user.
  if (p.phase === 'page') {
    clearResults();
    $('detect').className = p.detected ? 'detect found' : 'detect none';
    $('detect-ats').textContent = p.ats || '—';
    $('detect-count').textContent = `${p.detected} detected`;
    $('detect-role').textContent = p.role || '—';
    $('fill').disabled = !p.detected;
    $('fill-note').hidden = true;
    return;
  }

  if (p.phase === 'error') {
    resetFillButton();
    $('fill-note').textContent = p.message || 'Something went wrong.';
    $('fill-note').className = 'note warn';
    $('fill-note').hidden = false;
  }
});
