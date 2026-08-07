/* The side panel is three files that have to agree: markup, script and manifest.
   A typo'd id fails silently at runtime — the button simply does nothing — so it
   gets checked here instead of in the browser.                                 */
import { JSDOM } from 'jsdom';
import fs from 'fs';

const EXT = '../extension';
const html = fs.readFileSync(`${EXT}/sidepanel/sidepanel.html`, 'utf8');
const js = fs.readFileSync(`${EXT}/sidepanel/sidepanel.js`, 'utf8');
const css = fs.readFileSync(`${EXT}/sidepanel/sidepanel.css`, 'utf8');
const popupCss = fs.readFileSync(`${EXT}/popup/popup.css`, 'utf8');
const manifest = JSON.parse(fs.readFileSync(`${EXT}/manifest.json`, 'utf8'));
const content = fs.readFileSync(`${EXT}/content/index.js`, 'utf8');

const doc = new JSDOM(html).window.document;

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → ${JSON.stringify(got)}` : ''}`); }
};

/* ------------------------------------------------------------- manifest -- */
console.log('\n── the browser can actually open it ─────────────────────');
t('side_panel points at the panel', manifest.side_panel?.default_path === 'sidepanel/sidepanel.html');
t('sidePanel permission is requested', manifest.permissions.includes('sidePanel'));
t('no default_popup to suppress the click', !manifest.action?.default_popup);
t('the file it points at exists', fs.existsSync(`${EXT}/${manifest.side_panel.default_path}`));

const sw = fs.readFileSync(`${EXT}/background/service-worker.js`, 'utf8');
/* The click is ours to handle now: Chrome's built-in open-on-click can only ever
   open, and the icon has to cycle open → closed → open-fresh. */
t('Chrome does not handle the click itself',
  /setPanelBehavior\(\s*\{\s*openPanelOnActionClick:\s*false/.test(sw));
t('we handle it instead', /chrome\.action\.onClicked\.addListener/.test(sw));

/* ------------------------------------------------------- every id exists -- */
console.log('\n── every id the script reaches for is in the markup ─────');
const wanted = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
const unique = [...new Set(wanted)].sort();
const missing = unique.filter((id) => !doc.getElementById(id));
t(`${unique.length} ids referenced, all present`, missing.length === 0, missing);

/* -------------------------------------------------- and nothing is dead -- */
console.log('\n── every interactive control is wired ──────────────────');
const controls = [...doc.querySelectorAll('button[id], input[id], select[id]')].map((el) => el.id);
const unwired = controls.filter((id) => !js.includes(`'${id}'`));
t(`${controls.length} controls, all referenced by the script`, unwired.length === 0, unwired);

/* --------------------------------------------------------------- styles -- */
console.log('\n── the styles it depends on are defined ────────────────');
const styles = css + popupCss;
for (const cls of ['action-pair', 'avatar', 'menu', 'scrim', 'dialog', 'loader', 'fill-row', 'meta-strip', 'toggle']) {
  t(`.${cls}`, styles.includes(`.${cls}`));
}
t('the panel loads the shared popup stylesheet', html.includes('../popup/popup.css'));
t('the standalone setup layout exists', popupCss.includes('body.standalone'));

/* --------------------------------------------- the toolbar icon cycles -- */
console.log('\n── open → close → open fresh ───────────────────────────');
t('the panel holds a port so the worker knows it is open',
  /chrome\.runtime\.connect\(\{\s*name:\s*'jobfill-panel'/.test(js));
t('the worker listens for it', /port\.name !== 'jobfill-panel'/.test(sw));
t('a click while open asks the panel to close',
  /panelPorts\.has\(windowId\)[\s\S]{0,400}PANEL_CLOSE/.test(sw));
t('and the panel does close itself', /PANEL_CLOSE'\)\s*window\.close\(\)/.test(js));
t('closing marks the next open as a fresh one', /freshOnOpen\.add\(windowId\)/.test(sw));
t('closing with Chrome\'s own X counts too',
  /pagehide[\s\S]{0,200}PANEL_CLOSING/.test(js) && /PANEL_CLOSING'\)/.test(sw));
t('which the panel is told about on boot', /PANEL_BOOT/.test(js) && /PANEL_BOOT/.test(sw));
t('a fresh open clears the last application', /startFresh/.test(js));
t('and tells the page to forget its plan too', /RESET_SESSION/.test(js));
t('the content script honours that', /msg\.type === 'RESET_SESSION'/.test(content));
t('a recycled worker is not mistaken for a closed panel',
  /onDisconnect[\s\S]{0,200}connect\(windowId\)/.test(js));
t('there is a fallback for a panel that will not close', /forceClose/.test(sw));

/* ------------------------------------------------- the new controls work -- */
console.log('\n── refresh replaces Done ───────────────────────────────');
t('a refresh button sits beside Fill',
  Boolean(doc.querySelector('.action-pair #fill')) && Boolean(doc.querySelector('.action-pair #refresh')));
t('the Done button is gone', !doc.getElementById('done'));
t('it is an icon, not a word', Boolean(doc.querySelector('#refresh svg')));
t('and still names itself for screen readers',
  Boolean(doc.getElementById('refresh')?.getAttribute('aria-label')));

t('the confirm dialog asks before counting',
  /did you fill in all the forms/i.test(doc.getElementById('dlg-title')?.textContent || ''),
  doc.getElementById('dlg-title')?.textContent);
t('it starts hidden', doc.getElementById('scrim')?.hasAttribute('hidden'));
t('there is a loading state', Boolean(doc.querySelector('#dlg-busy .loader')));
t('"Not yet" only closes the dialog',
  /\$\('dlg-cancel'\)\.onclick = \(\) => \{ if \(!finishing\) dialog\.close\(\); \};/.test(js));
t('confirming records the application', js.includes('COMPLETE_APPLICATION'));
t('and then looks for the next step', js.includes('waitForNextStep'));
t('then reloads the fields from the page', /Loading the new fields/.test(js));
t('and fills the next step when there is one',
  /waitForNextStep[\s\S]{0,900}\$\('fill'\)\.click\(\)/.test(js));

/* ------------------------------------------- hidden actually hides ------ */
/* The bug this catches: `[hidden] { display: none }` lives in the user-agent
   stylesheet, and every author rule outranks it. So `.scrim { display: grid }`
   left the confirm dialog on screen with the attribute set — it greeted people
   the moment the panel opened, and "Not yet" looked like a dead button because
   the script was setting `hidden` and the CSS was overruling it silently.      */
console.log('\n── nothing marked hidden can render ────────────────────');
{
  // Comments and at-rule blocks both confuse a naive brace parse — a comment
  // sitting above a rule gets swallowed into its selector, and `el.matches()`
  // then throws and skips the very rule worth checking.
  const sheet = (css + popupCss)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(keyframes|media|supports)[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');

  t('the stylesheet states the rule itself',
    /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/.test(css + popupCss));

  // Every rule that sets `display`, paired with the selector that carries it.
  const rules = [...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim(), body }))
    .filter((r) => /(^|[;\s])display\s*:/.test(r.body) && !r.sel.startsWith('@'));

  const hiddenEls = [...doc.querySelectorAll('[hidden]')];
  t('the markup does rely on the attribute', hiddenEls.length > 0);

  const exposed = [];
  for (const el of hiddenEls) {
    for (const rule of rules) {
      for (const sel of rule.sel.split(',').map((s) => s.trim())) {
        if (!sel || sel.includes('[hidden]') || sel.includes(':')) continue;
        let matches = false;
        try { matches = el.matches(sel); } catch { continue; }
        // A rule that sets display on a hidden element is only safe if the
        // element also has a hidden state of its own, or the global !important
        // rule covers it — which the assertion above already checked.
        if (matches && !/display:\s*none/.test(rule.body)) {
          const guarded = rules.some((r) => r.sel.includes('[hidden]')
            && r.sel.split(',').some((s) => { try { return el.matches(s.trim()); } catch { return false; } }));
          if (!guarded) exposed.push(`#${el.id || el.className} ← ${sel}`);
        }
      }
    }
  }
  t('no hidden element has an unguarded display rule', exposed.length === 0, exposed);
  t('the scrim in particular has its own hidden state', /\.scrim\[hidden\]\s*\{[^}]*display:\s*none/.test(sheet));
}

/* --------------------------------------------- the dialog opens on cue -- */
console.log('\n── the dialog only opens when asked ────────────────────');
t('it is marked hidden in the markup', doc.getElementById('scrim')?.hasAttribute('hidden'));
t('only the refresh button opens it',
  (js.match(/dialog\.open\(\)/g) || []).length === 1 && /\$\('refresh'\)\.onclick[^\n]*dialog\.open\(\)/.test(js));
t('nothing opens it during boot', !/boot[\s\S]{0,400}dialog\.open/.test(js));
console.log('\n── the dialog cannot get stuck ─────────────────────────');
t('the network wait is bounded', /withTimeout\(/.test(js));
t('the step wait is bounded', /Date\.now\(\) < deadline/.test(js));
t('the close runs in a finally', /finally \{[\s\S]{0,400}dialog\.close\(\)/.test(js));
t('a re-entrant click cannot stack two runs', /if \(finishing\) return;/.test(js));
t('polling goes through the worker so a dead tab is re-injected',
  /send\('RESCAN_TAB'/.test(js) && /RESCAN_TAB:/.test(sw));
t('and the scan falls back the same way',
  /scanPage[\s\S]{0,700}send\('RESCAN_TAB'/.test(js));

t('the account button opens a menu', doc.getElementById('account-btn')?.getAttribute('aria-haspopup') === 'menu');
t('sign out lives inside that menu', Boolean(doc.querySelector('#account-menu #logout')));
t('the old bare logout icon is gone', !doc.querySelector('header > #logout'));
t('the menu closes on an outside click', /closest\('\.account'\)/.test(js));
t('and on Escape', /key === 'Escape'/.test(js));

t('the panel follows single-page step changes', js.includes("p.phase === 'page'"));
t('the content script watches history for them', /window\.history\[method\]\s*=\s*function patched/.test(content));
t('and polls for steps that do not change the URL', /window\.setInterval\([\s\S]{0,120}?debounced\(\)/.test(content));

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
