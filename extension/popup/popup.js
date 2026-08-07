/** Popup controller. All network access is delegated to the service worker. */

const $ = (id) => document.getElementById(id);
const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });

let mode = 'login';
let activeTab = null;

/* ---------------------------------------------------------------- boot -- */
/**
 * This page is now opened as a tab rather than a browser popup, so "the active
 * tab" is this page itself. The tab we actually care about is the most recently
 * used http(s) one, which is the form the user was looking at.
 */
async function findFormTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && /^https?:/.test(active.url || '')) return active;

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  return tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

(async function boot() {
  activeTab = await findFormTab();

  const { token, apiBase } = await chrome.storage.local.get(['token', 'apiBase']);
  $('api-base').value = apiBase || '';

  if (token) showMain();
  else showAuth();
})();

function showAuth() {
  $('auth').hidden = false;
  $('main').hidden = true;
  $('email').focus();
}

async function showMain() {
  $('auth').hidden = true;
  $('main').hidden = false;

  const { user } = await chrome.storage.local.get('user');
  $('user-name').textContent = user?.name || 'Your profile';
  $('user-email').textContent = user?.email || '';

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
  const v = $('api-base').value.trim();
  await send('SET_API_BASE', { apiBase: v });
  $('save-api').textContent = 'Address saved';
  setTimeout(() => { $('save-api').textContent = 'Save address'; }, 1600);
};

$('logout').onclick = async () => { await send('LOGOUT'); showAuth(); };

/* ---------------------------------------------------------- page scan -- */
async function scanPage() {
  const box = $('detect');
  try {
    if (!activeTab) throw new Error('no page');
    const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'SCAN_ONLY' });
    if (res?.ok && res.data.count > 0) {
      box.className = 'detect found';
      $('detect-ats').textContent = res.data.ats;
      $('detect-count').textContent = `${res.data.count} detected`;
      $('detect-role').textContent = res.data.page?.role || res.data.page?.company || '—';
      $('fill').disabled = false;
      return;
    }
    box.className = 'detect none';
    $('detect-ats').textContent = res?.data?.ats || 'None on this page';
    $('detect-count').textContent = '0 detected';
    $('detect-role').textContent = '—';
    $('fill').disabled = true;
  } catch {
    // No content script here — usually a chrome:// page or a tab opened before install.
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
  btn.classList.add('busy');
  btn.querySelector('.btn-label').textContent = 'Filling';
  note.hidden = true;

  try {
    if (!activeTab) throw new Error('no page');
    await chrome.tabs.sendMessage(activeTab.id, {
      type: 'RUN_AUTOFILL',
      payload: { resumeId: $('resume').value || undefined },
    });
    // The in-page panel takes over from here, so bring that tab forward.
    await chrome.tabs.update(activeTab.id, { active: true });
    setTimeout(() => window.close(), 400);
  } catch {
    btn.classList.remove('busy');
    btn.querySelector('.btn-label').textContent = 'Fill this application';
    note.textContent = 'Reload the page, then run the fill again.';
    note.className = 'note warn';
    note.hidden = false;
  }
};

$('save-answers').onclick = async () => {
  if (activeTab) await chrome.tabs.sendMessage(activeTab.id, { type: 'SAVE_ANSWERS_NOW' }).catch(() => {});
  $('save-answers').textContent = 'Answers saved';
  setTimeout(() => { $('save-answers').textContent = 'Save answers'; }, 1800);
};

$('open-dashboard').onclick = async () => {
  const { apiBase, dashboardUrl } = await chrome.storage.local.get(['apiBase', 'dashboardUrl']);
  chrome.tabs.create({ url: dashboardUrl || (apiBase || 'http://localhost:5173').replace(/:4000$/, ':5173') });
};
