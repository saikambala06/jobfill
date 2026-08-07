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

let mode = 'login';
let formTab = null;
let rows = [];

/* ---------------------------------------------------------------- boot -- */
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && /^https?:/.test(tab.url || '') ? tab : null;
}

(async function boot() {
  formTab = await currentTab();

  const { apiBase } = await chrome.storage.local.get('apiBase');
  $('api-base').value = apiBase || '';

  const { token } = await chrome.storage.local.get('token');
  if (token) showMain(); else showAuth();
})();

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

async function showMain() {
  $('auth').hidden = true;
  $('main').hidden = false;

  const { user, autoFillNewSteps } = await chrome.storage.local.get(['user', 'autoFillNewSteps']);
  $('user-name').textContent = user?.name || 'Your profile';
  $('user-email').textContent = user?.email || '';
  $('auto-steps').checked = Boolean(autoFillNewSteps);

  scanPage();
  loadResumes();
  loadProfile();
  loadStats();
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

$('logout').onclick = async () => { await send('LOGOUT'); clearResults(); showAuth(); };

/* ---------------------------------------------------------- page scan -- */
async function scanPage() {
  const box = $('detect');
  try {
    if (!formTab) throw new Error('no page');
    const res = await chrome.tabs.sendMessage(formTab.id, { type: 'SCAN_ONLY' });
    if (res?.ok && res.data.count > 0) {
      box.className = 'detect found';
      $('detect-ats').textContent = res.data.ats;
      $('detect-count').textContent = `${res.data.count} detected`;
      $('detect-role').textContent = res.data.page?.role || res.data.page?.company || '—';
      $('fill').disabled = false;
      return;
    }
    box.className = 'detect none';
    $('detect-ats').textContent = res?.data?.ats || 'No form on this page';
    $('detect-count').textContent = '0 detected';
    $('detect-role').textContent = '—';
    $('fill').disabled = true;
  } catch {
    // No content script here — a chrome:// page, or a tab opened before install.
    box.className = 'detect none';
    $('detect-ats').textContent = 'Not available here';
    $('detect-count').textContent = '—';
    $('detect-role').textContent = 'Reload the page and try again';
    $('fill').disabled = true;
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
  $('stat-apps').textContent = res.data.totalApplications ?? 0;
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

$('open-dashboard').onclick = async () => {
  const { apiBase, dashboardUrl } = await chrome.storage.local.get(['apiBase', 'dashboardUrl']);
  chrome.tabs.create({ url: dashboardUrl || (apiBase || 'http://localhost:5173').replace(/:4000$/, ':5173') });
};

$('auto-steps').onchange = async (e) => {
  await chrome.storage.local.set({ autoFillNewSteps: e.target.checked });
};

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
      $('fill-note').textContent = p.warning;
      $('fill-note').className = 'note warn';
      $('fill-note').hidden = false;
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

  if (p.phase === 'error') {
    resetFillButton();
    $('fill-note').textContent = p.message || 'Something went wrong.';
    $('fill-note').className = 'note warn';
    $('fill-note').hidden = false;
  }
});
