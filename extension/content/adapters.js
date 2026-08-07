/**
 * ATS adapters.
 *
 * Generic DOM detection gets most of the way, but every major ATS has at least one
 * structural habit that breaks it: Workday hides labels behind `data-automation-id`
 * and nests the form in an iframe, Greenhouse renders EEO in a separate island,
 * Workday and Ashby both use listbox widgets that ignore a plain `.value =` write.
 *
 * Each adapter contributes: identification, where the form actually lives, how to
 * read a label for that platform, and which quirks the filler must honour.
 */
(() => {
  const JF = (window.__JOBFILL__ = window.__JOBFILL__ || {});

  const has = (sel) => Boolean(document.querySelector(sel));
  const host = () => location.hostname;
  const hostIs = (...parts) => parts.some((p) => host().includes(p));

  /** @type {Array<object>} */
  const ADAPTERS = [
    {
      id: 'greenhouse',
      name: 'Greenhouse',
      match: () => hostIs('greenhouse.io', 'boards.greenhouse') || has('#grnhse_app, #application_form, [id^="greenhouse"]'),
      root: () => document.querySelector('#application_form, #grnhse_app, form#s3_upload_form') || document.body,
      // Greenhouse marks required fields with an asterisk span inside the label.
      labelClean: (t) => t.replace(/\*$/, '').trim(),
      quirks: { customSelects: '.select2-container, [class*="select__control"]', eeoRoot: '#eeo_section, [id*="demographic"]' },
    },
    {
      id: 'lever',
      name: 'Lever',
      match: () => hostIs('jobs.lever.co', 'lever.co') || has('.application-form, .lever-application'),
      root: () => document.querySelector('.application-form, form[action*="apply"]') || document.body,
      quirks: { cardQuestions: '.application-question', groupLabel: '.application-label' },
    },
    {
      id: 'workday',
      name: 'Workday',
      match: () => hostIs('myworkdayjobs.com', 'workday.com', 'wd1.', 'wd3.', 'wd5.') || has('[data-automation-id="jobApplication"], [data-automation-id]'),
      root: () => document.querySelector('[data-automation-id="jobApplication"], [data-automation-id="applyFlowPage"]') || document.body,
      /**
       * Each control lives in its own `formField-*` container and the label inside
       * THAT container is the one that belongs to it.
       *
       * The previous implementation reached up to the enclosing `div[role="group"]`
       * and took its first label, which meant every control inside a "Work
       * Experience 2" block — company, location, dates, description — was told it
       * was called "Job Title". That single line is what produced role descriptions
       * in Location boxes and phone numbers in Phone Extension.
       */
      labelFor: (el) => {
        const cell = el.closest('[data-automation-id^="formField"]')
          || el.closest('[data-automation-id]:not([role="group"])');
        if (cell) {
          // Only trust the container's label when the container really is one field.
          const controls = cell.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="combobox"]');
          if (controls.length <= 2) {
            const own = cell.querySelector('label, [id$="-label"], [class*="Label"], [class*="label"]');
            if (own && !own.contains(el)) {
              const t = own.textContent.replace(/\s+/g, ' ').replace(/[*\u2731]\s*$/, '').trim();
              if (t && t.length <= 120) return t;
            }
          }
          const auto = cell.getAttribute('data-automation-id') || '';
          if (auto && auto !== 'formField') return humanizeAutomationId(auto.replace(/^formField-/, ''));
        }
        return humanizeAutomationId(el.getAttribute('data-automation-id') || '');
      },
      /** The repeating-entry wrapper: "Work Experience 2", "Education 1", "Address". */
      sectionFor: (el) => {
        const group = el.closest('div[role="group"], fieldset, [data-automation-id*="Section"]');
        if (!group) return '';
        return (group.getAttribute('aria-label')
          || group.querySelector('h1,h2,h3,h4,h5,legend,[role="heading"]')?.textContent
          || '').replace(/\s+/g, ' ').trim();
      },
      quirks: {
        listbox: '[data-automation-id*="dropdown"], button[aria-haspopup="listbox"]',
        multiStep: true,
        typeahead: '[data-automation-id="searchBox"], input[role="combobox"]',
        fileButton: '[data-automation-id="select-files"]',
        slowRender: 400,
      },
    },
    {
      id: 'ashby',
      name: 'Ashby',
      match: () => hostIs('jobs.ashbyhq.com', 'ashbyhq.com') || has('[class*="_fieldEntry"], [class*="ashby-application"]'),
      root: () => document.querySelector('form, [class*="ashby-application-form"]') || document.body,
      quirks: { customSelects: '[class*="_option"], [role="listbox"]', fieldWrap: '[class*="_fieldEntry"]' },
    },
    {
      id: 'smartrecruiters',
      name: 'SmartRecruiters',
      match: () => hostIs('smartrecruiters.com', 'jobs.smartrecruiters.com') || has('[data-test="application-form"], .sr-application'),
      root: () => document.querySelector('[data-test="application-form"], form') || document.body,
      quirks: { customSelects: '[data-test*="select"]' },
    },
    {
      id: 'icims',
      name: 'iCIMS',
      match: () => hostIs('icims.com') || has('#icims_content, .iCIMS_MainWrapper'),
      root: () => document.querySelector('#icims_content, .iCIMS_ApplicationContainer') || document.body,
      // iCIMS renders the whole flow inside a nested iframe on many tenants.
      quirks: { iframe: 'iframe#icims_content_iframe, iframe[src*="icims"]', tableLayout: true },
    },
    {
      id: 'taleo',
      name: 'Taleo',
      match: () => hostIs('taleo.net', 'tbe.taleo', 'taleo.com') || has('[id^="requisitionDescriptionInterface"], .taleo-form'),
      root: () => document.querySelector('form[name="dynamicform"], #mainContainer') || document.body,
      quirks: { tableLayout: true, legacyPostback: true },
    },
    {
      id: 'successfactors',
      name: 'SAP SuccessFactors',
      match: () => hostIs('successfactors.com', 'successfactors.eu', 'jobs.sap.com') || has('[id*="careerSite"], .sfCareerSite'),
      root: () => document.querySelector('form, [id*="applicationForm"]') || document.body,
      quirks: { slowRender: 500 },
    },
    {
      id: 'oracle',
      name: 'Oracle Recruiting',
      match: () => hostIs('oraclecloud.com', 'fa.oraclecloud') || has('[data-oj-context], .oj-form'),
      root: () => document.querySelector('.oj-form, form') || document.body,
      quirks: { customSelects: '.oj-select, oj-select-single', slowRender: 400 },
    },
    {
      id: 'bamboohr',
      name: 'BambooHR',
      match: () => hostIs('bamboohr.com', 'bamboohr.co.uk') || has('#applicationForm, .BambooHR-ATS-board'),
      root: () => document.querySelector('#applicationForm, form') || document.body,
    },
    {
      id: 'jobvite',
      name: 'Jobvite',
      match: () => hostIs('jobvite.com', 'jobs.jobvite.com') || has('.jv-page, #jv-careersite'),
      root: () => document.querySelector('.jv-application, form') || document.body,
    },
    {
      id: 'teamtailor',
      name: 'Teamtailor',
      match: () => hostIs('teamtailor.com') || has('[data-controller*="application"]'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'recruitee',
      name: 'Recruitee',
      match: () => hostIs('recruitee.com') || has('.c-careers-site, [class*="recruitee"]'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'jazzhr',
      name: 'JazzHR',
      match: () => hostIs('applytojob.com', 'jazz.co', 'jazzhr.com') || has('#job-application, .jazzhr'),
      root: () => document.querySelector('#job-application, form') || document.body,
    },
    {
      id: 'zoho',
      name: 'Zoho Recruit',
      match: () => hostIs('zohorecruit.com', 'zoho.com/recruit') || has('#zr-application, [id^="zr_"]'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'bullhorn',
      name: 'Bullhorn',
      match: () => hostIs('bullhornstaffing.com', 'bullhorn.com', 'jobs.bullhorn') || has('.bh-application'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'adp',
      name: 'ADP Recruiting',
      match: () => hostIs('myjobs.adp.com', 'workforcenow.adp.com') || has('[id*="adp-"], .adp-application'),
      root: () => document.querySelector('form') || document.body,
      quirks: { slowRender: 400 },
    },
    {
      id: 'ukg',
      name: 'UKG',
      match: () => hostIs('ultipro.com', 'ukg.com', 'recruiting.ultipro') || has('[ng-app*="recruiting"]'),
      root: () => document.querySelector('form, [ng-app]') || document.body,
      quirks: { angularEvents: true },
    },
    {
      id: 'careerbuilder',
      name: 'CareerBuilder',
      match: () => hostIs('careerbuilder.com'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'indeed',
      name: 'Indeed',
      match: () => hostIs('indeed.com', 'indeed.co', 'smartapply.indeed'),
      root: () => document.querySelector('#ia-container, main, form') || document.body,
      quirks: { multiStep: true, iframe: 'iframe[title*="apply"], iframe#indeedapply-modal-iframe' },
    },
    {
      id: 'linkedin',
      name: 'LinkedIn Easy Apply',
      match: () => hostIs('linkedin.com'),
      root: () => document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, form') || document.body,
      // Easy Apply is a modal wizard: each "Next" swaps the whole field set.
      quirks: { multiStep: true, modal: '.jobs-easy-apply-modal', nextButton: 'button[aria-label*="Continue"], button[aria-label*="Next"]', slowRender: 300 },
    },
    {
      id: 'monster',
      name: 'Monster',
      match: () => hostIs('monster.com', 'monster.co'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'naukri',
      name: 'Naukri',
      match: () => hostIs('naukri.com'),
      root: () => document.querySelector('.apply-container, form') || document.body,
      quirks: { chipInputs: '.chipsContainer, .suggestor-input' },
    },
    {
      id: 'foundit',
      name: 'Foundit',
      match: () => hostIs('foundit.in', 'foundit.com', 'monsterindia.com'),
      root: () => document.querySelector('form') || document.body,
    },
    {
      id: 'dice',
      name: 'Dice',
      match: () => hostIs('dice.com'),
      root: () => document.querySelector('form, [data-cy*="apply"]') || document.body,
    },
    {
      id: 'wellfound',
      name: 'Wellfound',
      match: () => hostIs('wellfound.com', 'angel.co'),
      root: () => document.querySelector('form') || document.body,
    },
  ];

  /** `firstNameFieldOnApplication` → "First Name Field On Application" */
  function humanizeAutomationId(id) {
    if (!id) return '';
    return id
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\b(field|input|section|item|formfield)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const GENERIC = {
    id: 'generic',
    name: 'Company career page',
    match: () => true,
    root: () => {
      // Pick the form with the most inputs — career pages routinely carry a search
      // form and a newsletter form alongside the real application.
      const forms = [...document.querySelectorAll('form')];
      if (!forms.length) return document.body;
      return forms.reduce((best, f) => {
        const n = f.querySelectorAll('input, select, textarea').length;
        return n > (best.n ?? 0) ? { el: f, n } : best;
      }, {}).el || document.body;
    },
    quirks: {},
  };

  JF.detectAdapter = function detectAdapter() {
    for (const a of ADAPTERS) {
      try { if (a.match()) return { ...GENERIC, ...a, quirks: { ...GENERIC.quirks, ...a.quirks } }; }
      catch { /* a broken matcher must never block the rest */ }
    }
    return GENERIC;
  };

  JF.ADAPTERS = ADAPTERS;
  JF.humanizeAutomationId = humanizeAutomationId;
})();
