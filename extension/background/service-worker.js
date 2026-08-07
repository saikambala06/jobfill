/**
 * Service worker.
 *
 * The only component that holds the auth token and talks to the API. Content
 * scripts run inside a job board's page context, so keeping credentials out of
 * there means a hostile or compromised page can never read them.
 */

const DEFAULT_API = 'http://localhost:4000';

async function apiBase() {
  const { apiBase } = await chrome.storage.local.get('apiBase');
  return (apiBase || DEFAULT_API).replace(/\/$/, '');
}

async function token() {
  const { token } = await chrome.storage.local.get('token');
  return token || null;
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = await token();
    if (!t) return { ok: false, error: 'Sign in from the extension popup to continue.', code: 401 };
    headers.Authorization = `Bearer ${t}`;
  }

  try {
    const res = await fetch(`${await apiBase()}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      await chrome.storage.local.remove(['token', 'user']);
      await setBadge('!', '#F25C7A');
      return { ok: false, error: data.error || 'Your session ended. Sign in again.', code: 401 };
    }
    if (!res.ok) return { ok: false, error: data.error || `Request failed (${res.status})`, code: res.status };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Cannot reach the server. Check your API URL in settings.' };
  }
}

async function setBadge(text, color = '#2B4CF2') {
  await chrome.action.setBadgeText({ text: String(text) });
  await chrome.action.setBadgeBackgroundColor({ color });
}

/* ------------------------------------------------------------ messaging -- */
const HANDLERS = {
  PLAN_FILL: (p) => api('/api/autofill/plan', { method: 'POST', body: p }),
  DRAFT_ANSWER: (p) => api('/api/autofill/answer', { method: 'POST', body: p }),
  COVER_LETTER: (p) => api('/api/autofill/cover-letter', { method: 'POST', body: p }),
  SAVE_ANSWERS: (p) => api('/api/answers/bulk', { method: 'POST', body: p }),
  MATCH_ANSWER: (p) => api('/api/answers/match', { method: 'POST', body: p }),
  RECORD_FILL: (p) => api('/api/autofill/record', { method: 'POST', body: p }),
  GET_DOCUMENT: (p) => api(`/api/resumes/${p.id}/file`),
  LIST_RESUMES: () => api('/api/resumes'),
  GET_PROFILE: () => api('/api/profile'),
  GET_STATS: () => api('/api/applications/stats'),

  LOGIN: async (p) => {
    const res = await api('/api/auth/login', { method: 'POST', body: p, auth: false });
    if (res.ok) {
      await chrome.storage.local.set({ token: res.data.token, user: res.data.user });
      await setBadge('');
    }
    return res;
  },
  REGISTER: async (p) => {
    const res = await api('/api/auth/register', { method: 'POST', body: p, auth: false });
    if (res.ok) await chrome.storage.local.set({ token: res.data.token, user: res.data.user });
    return res;
  },
  LOGOUT: async () => {
    await chrome.storage.local.remove(['token', 'user']);
    await setBadge('');
    return { ok: true };
  },
  SET_API_BASE: async (p) => {
    await chrome.storage.local.set({ apiBase: p.apiBase });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'PAGE_READY') {
    // Badge the tab so the user knows a fillable form was recognised.
    chrome.action.setBadgeText({ text: '●', tabId: sender.tab?.id }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#2B4CF2', tabId: sender.tab?.id }).catch(() => {});
    respond({ ok: true });
    return true;
  }

  const handler = HANDLERS[msg.type];
  if (!handler) { respond({ ok: false, error: `Unknown action ${msg.type}` }); return true; }

  handler(msg.payload || {}).then(respond).catch((err) => respond({ ok: false, error: err.message }));
  return true; // keeps the channel open for the async reply
});

/* ---------------------------------------------------------- entrypoints -- */
const CONTENT_FILES = [
  'content/adapters.js', 'content/detector.js', 'content/filler.js',
  'content/overlay.js', 'content/index.js',
];

/** Talk to the page, injecting the content script first if it is not there yet. */
async function tell(tab, message) {
  if (!tab?.id || !/^https?:/.test(tab.url || '')) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // The content script may not be injected on a tab that predates install.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id, allFrames: true }, files: ['content/content.css'] });
    return chrome.tabs.sendMessage(tab.id, message).catch(() => null);
  }
}

async function triggerFill(tab, opts = {}) {
  return tell(tab, { type: 'RUN_AUTOFILL', payload: opts });
}

/**
 * The toolbar icon toggles the in-page panel.
 *
 * With no `default_popup` in the manifest this handler fires on every click, so
 * the panel opens on one click and closes on the next — and, because it lives in
 * the page rather than in a browser popup, clicking anywhere on the form leaves it
 * exactly where it was.
 */
chrome.action.onClicked.addListener(async (tab) => {
  const { token } = await chrome.storage.local.get('token');
  if (!token) {
    // Nothing useful to show until there is an account behind it.
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    return;
  }
  if (!/^https?:/.test(tab?.url || '')) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
    return;
  }
  await tell(tab, { type: 'TOGGLE_PANEL', payload: {} });
});

chrome.commands?.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (command === 'autofill') triggerFill(tab);
  if (command === 'save-answers') chrome.tabs.sendMessage(tab.id, { type: 'SAVE_ANSWERS_NOW' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({ apiBase: DEFAULT_API, autoFillNewSteps: true });
    chrome.tabs.create({ url: 'popup/popup.html?welcome=1' });
  }
});

self.__jobfillTriggerFill = triggerFill;
