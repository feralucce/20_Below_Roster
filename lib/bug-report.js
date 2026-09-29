// Report a Bug: one dialog shared by every 20 Below tool.
//
// A player writes what happened; the tool fills in which app, which
// version and where they were. The report goes to the bug relay
// (tools/bug-relay/), which files it as a numbered ticket in the team's
// Discord forum. If the relay can't be reached, the player can copy the
// report instead, so nothing they wrote is lost.
//
// Nothing about the player's character is sent. Only what they type,
// plus the details listed under "Sent with your report", which they can
// read before sending.
//
//   import { addBugReportButton } from '../app/bug-report.js';
//   addBugReportButton(container, { app: 'Battle Tracker' });

// Set once the relay is deployed (tools/bug-relay/README.md, step 6).
export const BUG_RELAY_URL = 'https://20below-bugs.20below.workers.dev/report';

// A test page can point the dialog at a local relay instead.
function relayUrl() {
  return (typeof window !== 'undefined' && window.__BUG_RELAY_URL__) || BUG_RELAY_URL;
}

// The Section list in the dialog, per app: each tool's own tab and step
// names, so a report lands where the team will look for it.
const TRACKER_SECTIONS = [
  ['Catalog', ['Browsing and searching', 'Headings and tags', 'Adding or editing a creature', 'Import or export']],
  ['Encounter', ['Building the encounter', 'Initiative', 'Rounds and resolving', 'Rolling dice', 'Rests and Fate Tokens', 'Tokens on the scene', 'Saved encounters']],
];
export const SECTIONS = {
  'Character Creator': [
    ['Creating a character', ['Bonus Points', 'Name & Concept', 'Nature', 'Attributes (Elements)', 'Sub-Stat Division', 'Descriptors', 'Boons', 'Flaws', 'Skills', 'Resources', 'Gifts', 'Gift Menus', 'Discretionary Points', 'Equipment']],
    ['Character sheet', ['Vitals', 'Skills', 'Gifts', 'Boons/Flaws', 'Resources', 'Equipment', 'Biography', 'XP']],
    ['Around the app', ['Dice roller', 'Saving and loading', 'Printing or PDF']],
  ],
  'Owlbear Character Sheet': [
    ['Sheet', ['Vitals', 'Skills', 'Gifts', 'Gear', 'Notes', 'Advance', 'Log']],
    ['Around the sheet', ['Rolling dice', 'Loading and saving']],
  ],
  'Battle Tracker': TRACKER_SECTIONS,
  'Owlbear Battle Tracker': TRACKER_SECTIONS,
  'Website': [
    ['Website', ['Rules pages', 'Quick reference sheets', 'Downloads', 'Links and menus', 'How a page looks on my screen']],
  ],
};
const ANYWHERE = 'Something else';

const STYLE_ID = 'bug-report-style';
const CSS = `
.bug-report-btn { font: inherit; font-size: 0.85em; cursor: pointer; background: transparent; color: inherit; border: 1px solid currentColor; border-radius: 999px; padding: 0.2em 0.8em; opacity: 0.8; }
.bug-report-btn:hover { opacity: 1; }
dialog.bug-report { max-width: 34rem; width: calc(100% - 2rem); border: 1px solid #24404f; border-radius: 10px; padding: 0; background: #12232e; color: #eaf5fb; font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.45; }
dialog.bug-report::backdrop { background: rgba(0, 0, 0, 0.6); }
.bug-report form { padding: 1.1rem 1.25rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
.bug-report h2 { margin: 0; font-size: 1.15rem; }
.bug-report .intro { margin: 0; color: #8fadbe; font-size: 0.9rem; }
.bug-report label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.88rem; font-weight: 600; }
.bug-report label span.opt { font-weight: 400; color: #8fadbe; }
.bug-report input, .bug-report textarea, .bug-report select { font: inherit; font-weight: 400; font-size: 0.95rem; color: #eaf5fb; background: #0a1720; border: 1px solid #24404f; border-radius: 6px; padding: 0.45rem 0.55rem; }
.bug-report textarea { resize: vertical; min-height: 4.5rem; }
.bug-report input:focus, .bug-report textarea:focus, .bug-report select:focus { outline: 2px solid #3d84c4; outline-offset: 1px; }
.bug-report details { font-size: 0.82rem; color: #8fadbe; }
.bug-report details pre { white-space: pre-wrap; margin: 0.4rem 0 0; font-size: 0.8rem; background: #0a1720; border-radius: 6px; padding: 0.5rem; }
.bug-report .row { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; }
.bug-report .row button { font: inherit; font-size: 0.9rem; cursor: pointer; border-radius: 999px; padding: 0.4rem 1rem; border: 1px solid #3d84c4; background: transparent; color: #eaf5fb; }
.bug-report .row button.primary { background: #3d84c4; color: #fff; }
.bug-report .row button:disabled { opacity: 0.5; cursor: default; }
.bug-report .status { margin: 0; font-size: 0.9rem; }
.bug-report .status.error { color: #ff9b8a; }
.bug-report .status.done { color: #7fd6a4; }
.bug-report .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function isDesktop() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

async function versionText() {
  if (isDesktop()) {
    try { return 'Desktop v' + (await window.__TAURI__.app.getVersion()); } catch { /* fall through */ }
  }
  // The web builds have no version number; the fingerprint of the page's
  // main module identifies exactly which release is loaded.
  const map = document.querySelector('script[type="importmap"]');
  const stamp = map && /\?v=([0-9a-f]{6,})/.exec(map.textContent);
  return stamp ? 'Web build ' + stamp[1] : 'Web';
}

export async function reportContext(app, extra = '') {
  const lines = [
    'App: ' + app,
    'Version: ' + (await versionText()),
    'Page: ' + location.host + location.pathname + (location.hash || ''),
    'Browser: ' + navigator.userAgent,
    'Screen: ' + window.innerWidth + 'x' + window.innerHeight,
    'Time: ' + new Date().toISOString(),
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

function field(labelText, control, optional) {
  const label = document.createElement('label');
  const name = document.createElement('span');
  name.append(labelText);
  if (optional) {
    const opt = document.createElement('span');
    opt.className = 'opt';
    opt.textContent = ' (optional)';
    name.append(opt);
  }
  label.append(name, control);
  return label;
}

function sectionSelect(app) {
  const select = document.createElement('select');
  select.name = 'section'; select.required = true;
  const prompt = document.createElement('option');
  prompt.value = ''; prompt.textContent = 'Choose where it happened…';
  prompt.disabled = true; prompt.selected = true;
  select.append(prompt);
  for (const [group, names] of SECTIONS[app] || []) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const name of names) {
      const o = document.createElement('option');
      o.value = group === 'Website' ? name : group + ': ' + name;
      o.textContent = name;
      og.append(o);
    }
    select.append(og);
  }
  const other = document.createElement('option');
  other.value = other.textContent = ANYWHERE;
  select.append(other);
  return select;
}

function textarea(name, rows, placeholder) {
  const t = document.createElement('textarea');
  t.name = name; t.rows = rows; t.placeholder = placeholder || '';
  return t;
}

export function reportAsText(report) {
  return [
    'BUG REPORT: ' + report.summary,
    'Section: ' + (report.section || ANYWHERE),
    '',
    'Description:', report.happened,
    report.expected ? '\nWhat I expected:\n' + report.expected : '',
    report.steps ? '\nSteps to reproduce:\n' + report.steps : '',
    report.contact ? '\nContact: ' + report.contact : '',
    '',
    report.context,
  ].filter((s) => s !== '').join('\n');
}

export async function openBugReport({ app, extraContext = '' } = {}) {
  ensureStyle();
  const context = await reportContext(app || 'Other', extraContext);

  const dialog = document.createElement('dialog');
  dialog.className = 'bug-report';
  const form = document.createElement('form');
  form.method = 'dialog';

  const title = document.createElement('h2');
  title.textContent = 'Report a bug';
  const intro = document.createElement('p');
  intro.className = 'intro';
  intro.textContent = 'Tell us what went wrong. It goes straight to the 20 Below team as a numbered ticket.';

  const summary = document.createElement('input');
  summary.name = 'summary'; summary.maxLength = 100; summary.required = true;
  summary.placeholder = 'e.g. Initiative order doesn’t update';
  const section = sectionSelect(app);
  const happened = textarea('happened', 4, 'What were you doing, and what went wrong?');
  happened.required = true; happened.maxLength = 2000;
  const expected = textarea('expected', 2, 'What should have happened?');
  expected.maxLength = 1000;
  const steps = textarea('steps', 3, '1. Open…  2. Click…');
  steps.maxLength = 1500;
  const contact = document.createElement('input');
  contact.name = 'contact'; contact.maxLength = 200;
  contact.placeholder = 'Discord name or email, if you’d like a reply';
  const hp = document.createElement('input');
  hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off';
  const hpWrap = document.createElement('div');
  hpWrap.className = 'hp'; hpWrap.setAttribute('aria-hidden', 'true'); hpWrap.append(hp);

  const details = document.createElement('details');
  const sumEl = document.createElement('summary');
  sumEl.textContent = 'Sent with your report';
  const pre = document.createElement('pre');
  pre.textContent = context + '\n(Nothing from your character is sent.)';
  details.append(sumEl, pre);

  const status = document.createElement('p');
  status.className = 'status'; status.setAttribute('role', 'status');

  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'Cancel';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.textContent = 'Copy report'; copy.hidden = true;
  const send = document.createElement('button');
  send.type = 'submit'; send.className = 'primary'; send.textContent = 'Send report';
  const row = document.createElement('div');
  row.className = 'row'; row.append(cancel, copy, send);

  form.append(title, intro,
    field('Short title', summary),
    field('Section', section),
    field('Description', happened),
    field('What you expected', expected, true),
    field('Steps to make it happen again', steps, true),
    field('How to reach you', contact, true),
    hpWrap, details, status, row);
  dialog.append(form);
  document.body.append(dialog);

  const collect = () => ({
    app: app || 'Other',
    summary: summary.value.trim(),
    section: section.value,
    happened: happened.value.trim(),
    expected: expected.value.trim(),
    steps: steps.value.trim(),
    contact: contact.value.trim(),
    context,
    website: hp.value,
  });

  const close = () => { dialog.close(); dialog.remove(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', () => setTimeout(() => dialog.remove(), 0));

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reportAsText(collect()));
      status.className = 'status done';
      status.textContent = 'Copied. Paste it into the 20 Below Discord, or send it to the team another way.';
    } catch {
      status.className = 'status error';
      status.textContent = 'Couldn’t copy automatically. Select the text you wrote and copy it by hand.';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const report = collect();
    if (report.summary.length < 3 || !report.section || report.happened.length < 5) {
      status.className = 'status error';
      status.textContent = 'Please add a short title, choose a section and describe the bug.';
      return;
    }
    const url = relayUrl();
    if (!url) {
      status.className = 'status error';
      status.textContent = 'Sending isn’t switched on yet. Copy the report and paste it into the 20 Below Discord.';
      copy.hidden = false;
      return;
    }
    send.disabled = true;
    status.className = 'status';
    status.textContent = 'Sending…';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The report could not be sent.');
      status.className = 'status done';
      status.textContent = data.ticket
        ? `Thank you! Your report is ticket #${data.ticket}.`
        : 'Thank you! Your report was sent.';
      send.hidden = true;
      cancel.textContent = 'Close';
    } catch (err) {
      status.className = 'status error';
      status.textContent = (err && err.message ? err.message : 'The report could not be sent.') + ' You can copy it instead.';
      copy.hidden = false;
      send.disabled = false;
    }
  });

  dialog.showModal();
  summary.focus();
  return dialog;
}

export function addBugReportButton(container, { app, extraContext, label = 'Report a bug' } = {}) {
  if (!container) return null;
  ensureStyle();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bug-report-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => openBugReport({
    app,
    extraContext: typeof extraContext === 'function' ? extraContext() : extraContext,
  }));
  container.append(btn);
  return btn;
}
