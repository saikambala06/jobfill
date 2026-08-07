/**
 * In-page overlay.
 *
 * Rendered into a shadow root so no job board's stylesheet can reach it and none
 * of our styles leak onto their form. Its job is narrow: show what is being filled,
 * then hand back a review list of the answers a human should actually check before
 * submitting — the eligibility and free-text ones.
 */
(() => {
  const JF = (window.__JOBFILL__ = window.__JOBFILL__ || {});

  const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.panel {
  --ink:#14161C; --paper:#F4F6F9; --carbon:#C8CEDA;
  --blue:#2B4CF2; --pink:#F25C7A; --amber:#E0A82E;
  --rule: color-mix(in srgb, var(--carbon) 70%, transparent);

  position: fixed; right: 20px; bottom: 20px; width: 348px; max-height: 74vh;
  z-index: 2147483647;
  display: flex; flex-direction: column;
  background: var(--paper); color: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 4px;
  box-shadow: 6px 6px 0 rgba(20,22,28,.14);
  font-family: "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 13px; line-height: 1.45;
  animation: slide-in .34s cubic-bezier(.2,.9,.3,1) both;
}
@keyframes slide-in { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none } }

/* header reads like a form's own header block */
.head {
  display:flex; align-items:baseline; gap:8px;
  padding:11px 13px; border-bottom:1px solid var(--ink);
  background: var(--ink); color: var(--paper);
}
.head .mark {
  font: 600 10px/1 ui-monospace, "IBM Plex Mono", monospace;
  letter-spacing:.14em; text-transform:uppercase;
  border:1px solid var(--paper); padding:4px 5px; border-radius:2px;
}
.head .title { font-weight:650; letter-spacing:-.01em; flex:1; font-size:13px; }
.head .close {
  all:unset; cursor:pointer; font-size:16px; line-height:1; opacity:.6; padding:2px 4px;
}
.head .close:hover, .head .close:focus-visible { opacity:1; outline:1px solid var(--paper); }

.meta {
  display:flex; gap:14px; padding:9px 13px; border-bottom:1px dashed var(--rule);
  font: 500 10px/1.3 ui-monospace, "IBM Plex Mono", monospace;
  letter-spacing:.06em; text-transform:uppercase; color:#4A5262;
}
.meta b { display:block; font-size:16px; font-weight:650; color:var(--ink); letter-spacing:-.02em; }

/* the fill trace: a rule that draws itself left-to-right as work completes */
.trace { height:3px; background:var(--carbon); position:relative; overflow:hidden; }
.trace i {
  position:absolute; inset:0 auto 0 0; width:0%; background:var(--blue);
  transition: width .3s cubic-bezier(.4,0,.2,1);
}
.trace i::after {
  content:''; position:absolute; right:-2px; top:0; bottom:0; width:2px; background:var(--pink);
}

.body { overflow-y:auto; flex:1; }
.body::-webkit-scrollbar { width:8px }
.body::-webkit-scrollbar-thumb { background:var(--carbon); border-radius:4px }

.section-label {
  padding:10px 13px 5px;
  font: 600 9px/1 ui-monospace, "IBM Plex Mono", monospace;
  letter-spacing:.16em; text-transform:uppercase; color:#6C7488;
}

/* each row is a form row: mono key, hairline, value */
.row { padding:8px 13px; border-bottom:1px dotted var(--rule); }
.row.new { animation: stamp .28s cubic-bezier(.2,.9,.3,1) both }
@keyframes stamp {
  from { opacity:0; transform: translateX(-5px) }
  to   { opacity:1; transform:none }
}
@media (prefers-reduced-motion: reduce) { .row.new { animation:none } }

.row .k {
  font: 500 10px/1.3 ui-monospace, "IBM Plex Mono", monospace;
  color:#5A6274; letter-spacing:.02em;
  display:flex; align-items:center; gap:6px;
}
.row .v { margin-top:3px; font-size:12.5px; word-break:break-word; }
.row .v.empty { color:#8A92A4; font-style:italic }

.tag {
  font: 600 8.5px/1 ui-monospace, monospace; letter-spacing:.1em; text-transform:uppercase;
  padding:2px 4px; border-radius:2px; border:1px solid currentColor; flex:none;
}
.tag.ai { color:var(--blue) }
.tag.memory { color:#4A7C59 }
.tag.rule { color:#6C7488 }
.tag.review { color:var(--pink) }

.row.review { background: color-mix(in srgb, var(--pink) 7%, transparent); border-left:2px solid var(--pink); padding-left:11px }

.actions { display:flex; gap:6px; margin-top:6px }
.mini {
  all:unset; cursor:pointer; font: 500 10px/1 ui-monospace, monospace;
  letter-spacing:.06em; text-transform:uppercase;
  padding:4px 7px; border:1px solid var(--carbon); border-radius:2px; color:#4A5262;
}
.mini:hover, .mini:focus-visible { border-color:var(--ink); color:var(--ink); background:#fff }
.mini[disabled] { opacity:.45; cursor:default }

.foot { padding:10px 13px; border-top:1px solid var(--ink); display:flex; gap:7px; background:#fff }
.btn {
  all:unset; cursor:pointer; text-align:center; flex:1;
  font: 600 11px/1 "Public Sans", sans-serif; letter-spacing:.04em;
  padding:9px; border-radius:3px; border:1px solid var(--ink);
}
.btn.primary { background:var(--blue); border-color:var(--blue); color:#fff }
.btn.primary:hover { background:#1E3AD4 }
.btn.ghost:hover { background:var(--paper) }
.btn:focus-visible { outline:2px solid var(--pink); outline-offset:2px }
.btn[disabled] { opacity:.5; cursor:default }

.note { padding:9px 13px; font-size:11.5px; color:#5A6274; border-bottom:1px dotted var(--rule) }
.note.warn { color:#8A5A00; background: color-mix(in srgb, var(--amber) 12%, transparent) }
`;

  let hostEl = null;
  let shadow = null;
  let state = { rows: [], stats: {}, page: {} };

  function ensure() {
    if (hostEl?.isConnected) return shadow;
    hostEl = document.createElement('div');
    hostEl.id = 'jobfill-overlay-host';
    hostEl.style.cssText = 'position:fixed;z-index:2147483647;inset:auto 0 0 auto;';
    shadow = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.append(style);
    document.documentElement.append(hostEl);
    return shadow;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render() {
    const s = ensure();
    const done = state.rows.filter((r) => r.ok).length;
    const total = state.stats.detected || state.rows.length || 1;
    const review = state.rows.filter((r) => r.ok && r.needsReview);

    const existing = s.querySelector('.panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="head">
        <span class="mark">JF</span>
        <span class="title">${esc(state.title || 'Filling application')}</span>
        <button class="close" aria-label="Close">×</button>
      </div>
      <div class="trace"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
      <div class="meta">
        <span>Detected<b>${state.stats.detected ?? '—'}</b></span>
        <span>Filled<b>${done}</b></span>
        <span>To check<b>${review.length}</b></span>
      </div>
      ${state.warning ? `<div class="note warn">${esc(state.warning)}</div>` : ''}
      <div class="body">
        ${review.length ? `<div class="section-label">Check before you submit</div>` : ''}
        ${review.map(rowHtml).join('')}
        ${state.rows.filter((r) => r.ok && !r.needsReview).length
          ? `<div class="section-label">Filled from your profile</div>` : ''}
        ${state.rows.filter((r) => r.ok && !r.needsReview).map(rowHtml).join('')}
        ${state.unresolved?.length
          ? `<div class="section-label">Left blank — no matching data</div>
             ${state.unresolved.map((u) => `<div class="row"><div class="k">${esc(u.label || 'Unlabelled field')}</div><div class="v empty">Nothing in your profile matched this</div></div>`).join('')}`
          : ''}
      </div>
      <div class="foot">
        <button class="btn ghost" data-act="rescan">Scan again</button>
        <button class="btn primary" data-act="save">Save answers</button>
      </div>`;

    panel.querySelector('.close').onclick = () => JF.overlay.hide();
    panel.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => JF.overlay.onAction?.(b.dataset.act, b);
    });
    panel.querySelectorAll('[data-regen]').forEach((b) => {
      b.onclick = () => JF.overlay.onAction?.('regenerate', b, b.dataset.regen);
    });

    s.append(panel);
  }

  function rowHtml(r) {
    const tag = r.needsReview ? 'review' : (r.via || 'rule');
    const label = r.via === 'ai' ? 'AI' : r.via === 'memory' ? 'Saved' : r.via === 'rule' ? 'Profile' : r.via;
    const long = String(r.value ?? '').length > 90;
    return `
      <div class="row new ${r.needsReview ? 'review' : ''}">
        <div class="k">
          <span>${esc(r.label || 'Field')}</span>
          <span class="tag ${tag}">${esc(r.needsReview ? 'check' : label)}</span>
        </div>
        <div class="v">${esc(String(r.value ?? '').slice(0, 260))}${long ? '…' : ''}</div>
        ${long ? `<div class="actions"><button class="mini" data-regen="${esc(r.uid)}">Rewrite</button></div>` : ''}
      </div>`;
  }

  JF.overlay = {
    show(patch = {}) { state = { ...state, ...patch }; render(); },
    update(patch = {}) { Object.assign(state, patch); render(); },
    addRow(row) { state.rows = [...state.rows.filter((r) => r.uid !== row.uid), row]; render(); },
    progress(done, total) {
      const bar = shadow?.querySelector('.trace i');
      if (bar) bar.style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    },
    hide() { hostEl?.remove(); hostEl = null; },
    get state() { return state; },
    onAction: null,
  };
})();
