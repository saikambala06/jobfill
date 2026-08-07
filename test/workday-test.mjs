/* Reproduces the bugs reported from a real Workday application:
   - every field in a Work Experience group receives the group's first label
   - "Phone Device Type" is matched as the phone number
   - "Phone Extension" receives the phone number
   - repeating sections (Work Experience 1/2, Education 1/2) are not addressable
   - a whole address lands in Address Line 1                                  */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { matchField, readProfileValue } from '../server/src/lib/matcher.js';

const EXT = '../extension';

/* Workday's real shape: a role="group" per repeating entry, each control wrapped
   in its own [data-automation-id] formField container carrying the label. */
const html = `<!doctype html><html><body>
<div data-automation-id="jobApplication">

  <div role="group" aria-label="Work Experience 1">
    <h4>Work Experience 1</h4>
    <div data-automation-id="formField-jobTitle">
      <label for="wt1">Job Title</label><input id="wt1" data-automation-id="jobTitle">
    </div>
    <div data-automation-id="formField-company">
      <label for="wc1">Company</label><input id="wc1" data-automation-id="company">
    </div>
    <div data-automation-id="formField-location">
      <label for="wl1">Location</label><input id="wl1" data-automation-id="location">
    </div>
    <div data-automation-id="formField-roleDescription">
      <label for="wd1">Role Description</label><textarea id="wd1" data-automation-id="roleDescription"></textarea>
    </div>
  </div>

  <div role="group" aria-label="Work Experience 2">
    <h4>Work Experience 2</h4>
    <div data-automation-id="formField-jobTitle">
      <label for="wt2">Job Title</label><input id="wt2" data-automation-id="jobTitle">
    </div>
    <div data-automation-id="formField-company">
      <label for="wc2">Company</label><input id="wc2" data-automation-id="company">
    </div>
    <div data-automation-id="formField-location">
      <label for="wl2">Location</label><input id="wl2" data-automation-id="location">
    </div>
    <div data-automation-id="formField-roleDescription">
      <label for="wd2">Role Description</label><textarea id="wd2" data-automation-id="roleDescription"></textarea>
    </div>
  </div>

  <div role="group" aria-label="Education 1">
    <h4>Education 1</h4>
    <div data-automation-id="formField-school">
      <label for="s1">School or University</label><input id="s1" data-automation-id="school">
    </div>
    <div data-automation-id="formField-degree">
      <label for="d1">Degree</label><input id="d1" data-automation-id="degree">
    </div>
  </div>

  <div role="group" aria-label="Education 2">
    <h4>Education 2</h4>
    <div data-automation-id="formField-school">
      <label for="s2">School or University</label><input id="s2" data-automation-id="school">
    </div>
    <div data-automation-id="formField-degree">
      <label for="d2">Degree</label><input id="d2" data-automation-id="degree">
    </div>
  </div>

  <div role="group" aria-label="Address">
    <h4>Address</h4>
    <div data-automation-id="formField-addressLine1">
      <label for="a1">Address Line 1</label><input id="a1" data-automation-id="addressLine1">
    </div>
    <div data-automation-id="formField-city">
      <label for="ac">City</label><input id="ac" data-automation-id="city">
    </div>
    <div data-automation-id="formField-countryRegion">
      <label for="ar">Region</label><input id="ar" role="combobox" data-automation-id="countryRegion">
    </div>
    <div data-automation-id="formField-postalCode">
      <label for="ap">Postal Code</label><input id="ap" data-automation-id="postalCode">
    </div>
  </div>

  <div role="group" aria-label="Phone">
    <h4>Phone</h4>
    <div data-automation-id="formField-phoneType">
      <label for="pt">Phone Device Type</label><input id="pt" role="combobox" data-automation-id="phoneType">
    </div>
    <div data-automation-id="formField-countryPhoneCode">
      <label for="pcc">Country Phone Code</label><input id="pcc" role="combobox" data-automation-id="countryPhoneCode">
    </div>
    <div data-automation-id="formField-phoneNumber">
      <label for="pn">Phone Number</label><input id="pn" data-automation-id="phoneNumber">
    </div>
    <div data-automation-id="formField-phoneExtension">
      <label for="pe">Phone Extension</label><input id="pe" data-automation-id="phoneExtension">
    </div>
  </div>

</div></body></html>`;

const dom = new JSDOM(html, { url: 'https://ecolab.wd1.myworkdayjobs.com/en-US/ecolab_external/job/apply', pretendToBeVisual: true });
const { window } = dom;
window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 32, top: 0, left: 0, right: 200, bottom: 32, x: 0, y: 0 });
global.window = window; global.document = window.document; global.Node = window.Node;
global.CSS = window.CSS || { escape: (s) => s.replace(/([^\w-])/g, '\\$1') };
global.getComputedStyle = window.getComputedStyle.bind(window);
global.MutationObserver = window.MutationObserver;

for (const f of ['adapters.js', 'detector.js']) {
  new Function('window', 'document', 'location', 'CSS', 'Node', 'getComputedStyle', 'console', 'MutationObserver',
    fs.readFileSync(`${EXT}/content/${f}`, 'utf8'))(
    window, window.document, window.location, global.CSS, window.Node, global.getComputedStyle, console, global.MutationObserver);
}

const profile = {
  identity: { firstName: 'Vinitha', lastName: 'N', phone: '(203) 935-4054', phoneCountryCode: '+1' },
  location: { addressLine1: '8589 Stacy Rd', city: 'Mckinney', state: 'TX', country: 'United States', postalCode: '75070' },
  employment: [
    { title: 'Senior Data Analyst', company: 'Optum', location: 'Dallas, TX', description: 'Designed ETL pipelines…' },
    { title: 'Data Analyst', company: 'Truist Bank', location: 'Charlotte, NC', description: 'Developed forecasting models…' },
  ],
  education: [
    { institution: 'University of North Texas', degree: 'Master of Science' },
    { institution: 'Anna University', degree: 'Bachelor of Engineering' },
  ],
};

let pass = 0, fail = 0;
const t = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  → got ${JSON.stringify(got)}` : ''}`); }
};

const { fields } = window.__JOBFILL__.detectFields();
const byId = new Map(fields.map((f) => [f.id, f]));
const val = (id) => {
  const f = byId.get(id);
  if (!f) return '(field missing)';
  const m = matchField(f);
  return m ? readProfileValue(profile, m.key, f) : undefined;
};

console.log('\n── labels are per-field, not per-group ──────────────────');
t('Work Exp 1 job title labelled "Job Title"', byId.get('wt1')?.label === 'Job Title', byId.get('wt1')?.label);
t('Work Exp 1 company labelled "Company"', byId.get('wc1')?.label === 'Company', byId.get('wc1')?.label);
t('Work Exp 1 location labelled "Location"', byId.get('wl1')?.label === 'Location', byId.get('wl1')?.label);
t('Work Exp 2 company labelled "Company"', byId.get('wc2')?.label === 'Company', byId.get('wc2')?.label);
t('Phone Extension labelled "Phone Extension"', byId.get('pe')?.label === 'Phone Extension', byId.get('pe')?.label);

console.log('\n── repeating sections are addressable ───────────────────');
t('Work Exp 1 has sectionKind employment', byId.get('wt1')?.sectionKind === 'employment', byId.get('wt1')?.sectionKind);
t('Work Exp 1 index 0', byId.get('wt1')?.sectionIndex === 0, byId.get('wt1')?.sectionIndex);
t('Work Exp 2 index 1', byId.get('wt2')?.sectionIndex === 1, byId.get('wt2')?.sectionIndex);
t('Education 1 index 0', byId.get('s1')?.sectionIndex === 0, byId.get('s1')?.sectionIndex);
t('Education 2 index 1', byId.get('s2')?.sectionIndex === 1, byId.get('s2')?.sectionIndex);

console.log('\n── the right value reaches the right field ──────────────');
t('WE1 title  = Senior Data Analyst', val('wt1') === 'Senior Data Analyst', val('wt1'));
t('WE1 company= Optum', val('wc1') === 'Optum', val('wc1'));
t('WE2 title  = Data Analyst', val('wt2') === 'Data Analyst', val('wt2'));
t('WE2 company= Truist Bank', val('wc2') === 'Truist Bank', val('wc2'));
t('WE2 location= Charlotte, NC', val('wl2') === 'Charlotte, NC', val('wl2'));
t('Edu1 school= University of North Texas', val('s1') === 'University of North Texas', val('s1'));
t('Edu2 school= Anna University', val('s2') === 'Anna University', val('s2'));

console.log('\n── phone group keeps its four fields distinct ───────────');
t('Phone Number  = the number', val('pn') === '(203) 935-4054', val('pn'));
t('Phone Extension stays EMPTY', val('pe') === undefined, val('pe'));
t('Phone Device Type is NOT the number', val('pt') !== '(203) 935-4054', val('pt'));
t('Country Phone Code = +1', val('pcc') === '+1', val('pcc'));

console.log('\n── address is not one blob ──────────────────────────────');
t('Address Line 1 = street only', val('a1') === '8589 Stacy Rd', val('a1'));
t('City = Mckinney', val('ac') === 'Mckinney', val('ac'));
t('Postal Code = 75070', val('ap') === '75070', val('ap'));
t('Region = TX (state, not country)', val('ar') === 'TX', val('ar'));

console.log(`\n════ ${pass} passed, ${fail} failed ════\n`);
process.exit(fail ? 1 : 0);
