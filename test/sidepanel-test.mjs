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
t('openPanelOnActionClick is set', /setPanelBehavior\(\s*\{\s*openPanelOnActionClick:\s*true/.test(sw));
t('no action.onClicked listener (it would block the panel)',
  !/chrome\.action\.onClicked\.addListener/.test(sw));

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

/* ------------------------------------------------- the new controls work -- */
console.log('\n── this round\'s additions ──────────────────────────────');
t('Done sits beside Fill', Boolean(doc.querySelector('.action-pair #fill')) && Boolean(doc.querySelector('.action-pair #done')));
t('the confirm dialog asks before counting',
  /did you fill in all the forms/i.test(doc.getElementById('dlg-title')?.textContent || ''),
  doc.getElementById('dlg-title')?.textContent);
t('it starts hidden', doc.getElementById('scrim')?.hasAttribute('hidden'));
t('there is a loading state', Boolean(doc.querySelector('#dlg-busy .loader')));
t('confirming records the application', js.includes('COMPLETE_APPLICATION'));
t('and then looks for the next step', js.includes('waitForNextStep'));
t('which fills it', /waitForNextStep[\s\S]{0,600}\$\('fill'\)\.click\(\)/.test(js));

t('the account button opens a menu', doc.getElementById('account-btn')?.getAttribute('aria-haspopup') === 'menu');
t('sign out lives inside that menu', Boolean(doc.querySelector('#account-menu #logout')));
t('the old bare logout icon is gone', !doc.querySelector('header > #logout'));
t('the menu closes on an outside click', /closest\('\.account'\)/.test(js));
t('and on Escape', /key === 'Escape'/.test(js));

t('the panel follows single-page step changes', js.includes("p.phase === 'page'"));
const content = fs.readFileSync(`${EXT}/content/index.js`, 'utf8');
t('the content script watches history for them', /window\.history\[method\]\s*=\s*function patched/.test(content));
t('and polls for steps that do not change the URL', /window\.setInterval\([\s\S]{0,120}?debounced\(\)/.test(content));

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
