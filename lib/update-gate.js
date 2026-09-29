// The update gate: stops an outdated desktop app before it opens.
//
// The desktop apps are installed once and then read rules that keep
// changing. When a change breaks older copies - a skill tier removed, a
// file restructured - raise that app's number in /app-versions.json at
// the repo root. Every copy older than it then shows one screen, "you
// must update this app to continue", with a button to the installer,
// and nothing behind it can be used.
//
// Only the desktop apps are checked. The web tools and the Owlbear
// extensions are always the current version. Offline, or if GitHub
// can't be reached, the app opens as normal: it then runs on the rules
// it was built with, which it can read.
//
//   import { requireCurrentVersion } from '../app/update-gate.js';
//   requireCurrentVersion('creator');

const FLOORS_URL = 'https://raw.githubusercontent.com/feralucce/20_Below/main/app-versions.json';
const RELEASES_URL = 'https://api.github.com/repos/feralucce/20_Below/releases';
const DOWNLOADS_URL = 'https://20belowrpg.com/downloads.html';

// Each app's key in app-versions.json, and the tag its releases use.
export const GATED_APPS = {
  creator: { name: 'Character Creator', tag: /^v(\d+\.\d+\.\d+)$/ },
  'battle-tracker': { name: 'Battle Tracker', tag: /^combat-tracker-v(\d+\.\d+\.\d+)$/ },
  brewery: { name: 'Brewery', tag: /^brewery-v(\d+\.\d+\.\d+)$/ },
  prep: { name: 'Encounter Difficulty Calculator', tag: /^prep-v(\d+\.\d+\.\d+)$/ },
};

export const MESSAGE = 'Due to major infrastructure changes, you must update this app to continue.';

// Numeric, not string, comparison: "0.12.9" is older than "0.12.10".
export function isOlder(current, minimum) {
  const a = String(current).split('.').map(Number);
  const b = String(minimum).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

async function fetchJson(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

// The newest installer for this app, or the downloads page if the
// release list can't be read.
async function installerUrl(app) {
  try {
    const releases = await fetchJson(RELEASES_URL, 8000);
    const release = (releases || []).find((r) => app.tag.test(r.tag_name || ''));
    const exe = release && (release.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
    return (exe && exe.browser_download_url) || (release && release.html_url) || DOWNLOADS_URL;
  } catch {
    return DOWNLOADS_URL;
  }
}

const CSS = `
.update-gate { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: #0a1720; color: #eaf5fb; font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.5; }
.update-gate .card { max-width: 30rem; text-align: center; display: flex; flex-direction: column; gap: 0.9rem; }
.update-gate h1 { margin: 0; font-size: 1.4rem; }
.update-gate p { margin: 0; }
.update-gate .versions { color: #8fadbe; font-size: 0.9rem; }
.update-gate button { align-self: center; font: inherit; font-size: 1rem; cursor: pointer; border: 0; border-radius: 999px; padding: 0.55rem 1.4rem; background: #3d84c4; color: #fff; }
.update-gate button:disabled { opacity: 0.6; cursor: default; }
.update-gate .fallback { font-size: 0.85rem; color: #8fadbe; word-break: break-all; user-select: all; }
`;

export function showUpdateScreen(app, current, minimum) {
  const style = document.createElement('style');
  style.textContent = CSS;
  const gate = document.createElement('div');
  gate.className = 'update-gate';
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'update-gate-title');

  const card = document.createElement('div');
  card.className = 'card';
  const title = document.createElement('h1');
  title.id = 'update-gate-title';
  title.textContent = 'Update required';
  const message = document.createElement('p');
  message.textContent = MESSAGE;
  const versions = document.createElement('p');
  versions.className = 'versions';
  versions.textContent = `This copy of the ${app.name} is v${current}. You need v${minimum} or newer.`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Download the update';
  const fallback = document.createElement('p');
  fallback.className = 'fallback';
  fallback.hidden = true;

  button.addEventListener('click', async () => {
    button.disabled = true;
    const url = await installerUrl(app);
    try {
      await window.__TAURI__.opener.openUrl(url);
      button.textContent = 'Download started in your browser';
    } catch {
      // No way to open the browser from here: show the link to copy.
      fallback.hidden = false;
      fallback.textContent = 'Open this link in your browser: ' + url;
      button.hidden = true;
    }
  });

  card.append(title, message, versions, button, fallback);
  gate.append(card);
  // The page underneath stays loaded but can't be reached or used.
  if (document.body) document.body.inert = true;
  document.head.append(style);
  document.documentElement.append(gate);
  button.focus();
}

// Resolves true when the app may carry on, false when the update screen
// is showing. It never throws, and never blocks on a slow network for
// longer than a few seconds.
export async function requireCurrentVersion(key) {
  const app = GATED_APPS[key];
  const tauri = typeof window !== 'undefined' && window.__TAURI__;
  if (!app || !tauri) return true;
  try {
    const current = await tauri.app.getVersion();
    const floors = await fetchJson(FLOORS_URL, 5000);
    const minimum = floors && floors[key];
    if (typeof minimum !== 'string' || !isOlder(current, minimum)) return true;
    showUpdateScreen(app, current, minimum);
    return false;
  } catch {
    return true;
  }
}
