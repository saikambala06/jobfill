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
  COMPLETE_APPLICATION: (p) => api('/api/applications/complete', { method: 'POST', body: p }),
  GET_DOCUMENT: (p) => api(`/api/resumes/${p.id}/file`),
  LIST_RESUMES: () => api('/api/resumes'),
  GET_PROFILE: () => api('/api/profile'),
  GET_STATS: () => api('/api/applications/stats'),

  /**
   * Ask a tab what is on it, injecting the content script first if the tab has
   * lost it. A Workday step change can tear out the whole document, and the panel
   * polling a tab that no longer answers is what left the "Looking for the next
   * step…" spinner running with nothing behind it.
   */
  RESCAN_TAB: async (p) => {
    const tab = p.tabId ? await chrome.tabs.get(p.tabId).catch(() => null)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab) return { ok: false, error: 'No page to scan.' };
    const res = await tell(tab, { type: 'SCAN_ONLY', payload: { force: true } });
    if (!res) return { ok: false, error: 'This page cannot be read. Reload it and try again.' };
    return { ok: true, data: { ...res.data, tabId: tab.id, url: tab.url, title: tab.title } };
  },

  RESET_SESSION: async (p) => {
    const tab = p.tabId ? await chrome.tabs.get(p.tabId).catch(() => null)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab) await tell(tab, { type: 'RESET_SESSION' });
    return { ok: true };
  },

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

  // Broadcasts from the content script to the side panel pass straight through;
  // the worker is not their destination and must not answer on their behalf.
  if (msg.type === 'FILL_EVENT') { respond({ ok: true }); return true; }

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

/* ------------------------------------------------ side-panel toggle ----- */
/**
 * The toolbar icon cycles: open → closed → open fresh.
 *
 * Chrome's built-in `openPanelOnActionClick` only ever opens, so a second click
 * did nothing and there was no way to start over on a new application without
 * signing out. Driving the panel from our own `onClicked` handler costs us that
 * built-in behaviour — hence `openPanelOnActionClick: false` — but buys the third
 * state, which is the one that matters: reopening on a different job posting has
 * to forget the last one rather than describe it.
 *
 * Open/closed is not something Chrome will tell us, so the panel reports it. It
 * holds a long-lived port for exactly as long as it is on screen; the port dying
 * *is* the close event. The panel reconnects if the worker is recycled beneath
 * it, so this map stays true across a worker restart.
 */
const panelPorts = new Map();   // windowId → port
const freshOnOpen = new Set();  // windowIds whose next open must start clean
const PANEL_PATH = 'sidepanel/sidepanel.html';

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'jobfill-panel') return;
  let windowId = null;

  port.onMessage.addListener((msg) => {
    if (msg?.type === 'PANEL_CLOSING') {
      // A real teardown, however it was triggered — our close, or Chrome's own X.
      // Either way the next open is a new application.
      if (windowId !== null) freshOnOpen.add(windowId);
      return;
    }
    if (msg?.type !== 'PANEL_HELLO') return;
    windowId = msg.windowId;
    panelPorts.set(windowId, port);
    // Whether this open is a fresh start is decided here, not in storage: a
    // storage write racing a panel boot is exactly the kind of flake that makes
    // "sometimes it remembers, sometimes it doesn't" bugs.
    const fresh = freshOnOpen.delete(windowId);
    port.postMessage({ type: 'PANEL_BOOT', fresh });
  });

  port.onDisconnect.addListener(() => {
    if (windowId !== null && panelPorts.get(windowId) === port) panelPorts.delete(windowId);
  });
});

/**
 * Last resort for a panel that did not close itself. Disabling the panel for the
 * active tab dismisses it; it is re-enabled straight after so the next click can
 * open it again.
 */
async function forceClose(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab?.id) return;
  try {
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
    setTimeout(() => {
      chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true }).catch(() => {});
    }, 250);
  } catch (err) {
    console.warn('[jobfill] could not close the panel', err?.message);
  }
}

/**
 * `sidePanel.open()` must be reached without awaiting anything first — Chrome
 * checks that a user gesture is still in progress, and a resolved promise ends it.
 * That is why nothing in this handler is awaited before the open call.
 */
chrome.action.onClicked.addListener((tab) => {
  const windowId = tab?.windowId;
  if (windowId === undefined) return;

  if (panelPorts.has(windowId)) {
    // Second click: shut it. Mark the next open as a fresh one.
    freshOnOpen.add(windowId);
    try { panelPorts.get(windowId).postMessage({ type: 'PANEL_CLOSE' }); }
    catch { panelPorts.delete(windowId); }
    setTimeout(() => { if (panelPorts.has(windowId)) forceClose(windowId); }, 500);
    return;
  }

  chrome.sidePanel.open({ windowId }).catch((err) => {
    console.warn('[jobfill] side panel would not open', err?.message);
    freshOnOpen.delete(windowId);
  });
});

async function enableSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  } catch (err) {
    console.warn('[jobfill] side panel unavailable', err?.message);
  }
}
enableSidePanel();
chrome.runtime.onStartup?.addListener(enableSidePanel);


chrome.commands?.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (command === 'autofill') triggerFill(tab);
  if (command === 'save-answers') chrome.tabs.sendMessage(tab.id, { type: 'SAVE_ANSWERS_NOW' }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    // Filling starts when the user presses Fill, and only then. Watching for new
    // steps and filling them unprompted is available, but off until asked for.
    await chrome.storage.local.set({ apiBase: DEFAULT_API, autoFillNewSteps: false });
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?welcome=1') });
  }
});

self.__jobfillTriggerFill = triggerFill;
