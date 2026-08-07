/* End-to-end: the fields the detector produces must be exactly what the server's
   matcher consumes. This is the seam most likely to silently drift. */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { matchField, readProfileValue } from '../server/src/lib/matcher.js';

const EXT = '../extension';
const html = fs.readFileSync('form.html', 'utf8');
const dom = new JSDOM(html, { url: 'https://boards.greenhouse.io/acme/jobs/1', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 });
global.window = window; global.document = window.document; global.Node = window.Node;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.getComputedStyle = window.getComputedStyle.bind(window);
for (const f of ['adapters.js', 'detector.js']) {
  new Function('window','document','location','CSS','Node','getComputedStyle','console',
    fs.readFileSync(`${EXT}/content/${f}`, 'utf8'))(
    window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console);
}

const profile = {
  identity: { firstName: 'Priya', lastName: 'Raghavan', email: 'priya@example.com', phone: '+91 98765 43210' },
  location: { city: 'Hyderabad', country: 'India' },
  links: { linkedin: 'https://linkedin.com/in/priya' },
  eligibility: { requiresSponsorship: 'Yes' },
  compensation: { noticePeriod: '30 days' },
};

const { fields } = window.__JOBFILL__.detectFields();
let resolved = 0, escalated = 0;
console.log('\n── detector output → matcher → profile value ────────────');
for (const f of fields) {
  const m = matchField(f);
  const v = m ? readProfileValue(profile, m.key) : undefined;
  if (m && v !== undefined) resolved++; else escalated++;
  const status = m ? (v !== undefined ? '✓ filled' : '· no data') : '→ to AI';
  console.log(`  ${status.padEnd(10)} ${(f.label || '(none)').slice(0, 52).padEnd(54)} ${m ? m.key : ''}`);
}
console.log(`\n  ${resolved} filled from profile with zero AI calls, ${escalated} escalated.`);
process.exit(resolved >= 7 ? 0 : 1);
