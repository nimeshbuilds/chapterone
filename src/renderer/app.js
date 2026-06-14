'use strict';

/* global window, document */
// Wrapped in an IIFE so our top-level `const api` doesn't collide with the
// non-configurable `window.api` global injected by the preload contextBridge.
(function () {
const api = window.api;

const state = {
  view: 'library',
  settings: null,
  prereq: null,
  authStatus: null, // { claude:{installed,signedIn}, codex:{...}, gemini:{...} }
  models: { claude: [], codex: [], gemini: [], providers: [], imageModels: [], audioModels: [] },
  draftSpec: null,
  clarify: null,
  job: null,
};

// ---------- helpers ----------
function $(sel, root = document) { return root.querySelector(sel); }
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
function mount(node) { const r = $('#view-root'); r.innerHTML = ''; r.append(node); }
let toastTimer = null;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4600);
}
function svgDataUri(svg) {
  try { return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); }
  catch (_) { return ''; }
}
function coverGradient(seed) {
  let hash = 0;
  for (let i = 0; i < (seed || 'book').length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(150deg, hsl(${hue} 48% 34%), hsl(${(hue + 40) % 360} 58% 20%))`;
}
function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
}
async function updateSettings(partial) {
  state.settings = await api.saveSettings(partial);
  return state.settings;
}

// ---------- audio devices (mic / speaker) ----------
const audioPrefs = {
  get speaker() { return localStorage.getItem('bw.audio.speaker') || ''; },
  set speaker(v) { localStorage.setItem('bw.audio.speaker', v || ''); },
  get mic() { return localStorage.getItem('bw.audio.mic') || ''; },
  set mic(v) { localStorage.setItem('bw.audio.mic', v || ''); },
};
async function listDevices(kind) {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind); }
  catch (_) { return []; }
}
// Reuse a single mic stream so re-recording doesn't re-trigger the macOS mic
// permission prompt. Released when leaving Settings (see go()).
let activeMicStream = null;
let micStreamPromise = null; // in-flight getUserMedia, so double-clicks don't double-prompt
function stopMicStream() {
  if (activeMicStream) { try { activeMicStream.getTracks().forEach((t) => t.stop()); } catch (_) {} activeMicStream = null; }
}
async function getMicStream(deviceId) {
  if (activeMicStream && activeMicStream.getTracks().some((t) => t.readyState === 'live')) return activeMicStream;
  if (micStreamPromise) return micStreamPromise; // already asking — reuse the same request
  stopMicStream();
  micStreamPromise = navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
    .then((s) => { activeMicStream = s; return s; })
    .finally(() => { micStreamPromise = null; });
  return micStreamPromise;
}
async function applySink(audioEl) {
  const id = audioPrefs.speaker;
  if (id && audioEl && typeof audioEl.setSinkId === 'function') { try { await audioEl.setSinkId(id); } catch (_) { /* ignore */ } }
}
/** Decode a base64 data URI into a Blob (more reliable for <audio> than a giant data: src). */
function dataUriToBlob(dataUri) {
  const c = dataUri.indexOf(',');
  const mime = (dataUri.slice(0, c).match(/data:([^;]+)/) || [])[1] || 'audio/mpeg';
  const bin = atob(dataUri.slice(c + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
// Browsers hide device labels (and most of the device list) until the page has
// media permission. If the mic is already granted, do one silent getUserMedia so
// the full, named list is exposed — but never prompt just to read speaker names.
let _deviceLabelsUnlocked = false;
async function ensureDeviceLabels() {
  if (_deviceLabelsUnlocked) return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.some((d) => d.label)) { _deviceLabelsUnlocked = true; return; } // already exposed
    // Labels still hidden — only unlock if the mic is already granted; never
    // prompt just to read speaker names.
    let granted = false;
    try { granted = (await navigator.permissions.query({ name: 'microphone' })).state === 'granted'; } catch (_) { /* unsupported */ }
    if (!granted) return;
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop()); // labels stay exposed for the session after this
    _deviceLabelsUnlocked = true;
  } catch (_) { /* ignore */ }
}
/** A device <select> for speakers or mics. Populated once labels are available and
 *  refreshed only when devices actually change — never during the open gesture, which
 *  would wipe the native menu mid-open. Call sel._refresh() to repopulate on demand. */
function deviceSelect(kind, current, onChange, firstLabel) {
  const sel = h('select', { class: 'reader-select' }, h('option', { value: '' }, firstLabel));
  const fill = async () => {
    const keep = sel.value || current || '';
    const devs = await listDevices(kind);
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, firstLabel));
    devs.forEach((d, i) => sel.append(h('option', { value: d.deviceId },
      d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}`)));
    sel.value = (keep && Array.from(sel.options).some((o) => o.value === keep)) ? keep : '';
  };
  // Unmask names first (no prompt unless the mic is already granted), then populate.
  ensureDeviceLabels().finally(fill);
  // Re-list only when hardware is added/removed — safe, never during a click.
  try { navigator.mediaDevices.addEventListener('devicechange', fill); } catch (_) { /* ignore */ }
  sel.addEventListener('change', () => onChange(sel.value));
  sel._refresh = fill;
  return sel;
}

// ---------- navigation ----------
async function go(view, arg) {
  if (view !== 'reader' && state.readerKeys) { document.removeEventListener('keydown', state.readerKeys); state.readerKeys = null; }
  if (view !== 'progress' && state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
  if (state.view === 'settings' && view !== 'settings') stopMicStream(); // free the mic when leaving Settings
  state.view = view;
  setActiveNav(['library', 'create', 'kids', 'settings'].includes(view) ? view : 'library');
  if (view === 'library') return renderLibrary();
  if (view === 'create') return renderCreate();
  if (view === 'kids') return renderKidsCreate();
  if (view === 'clarify') return renderClarify();
  if (view === 'progress') return renderProgress();
  if (view === 'reader') return renderReader(arg);
  if (view === 'settings') return renderSettings();
}

// ---------- prerequisite banner ----------
async function refreshPrereq() {
  try { state.prereq = await api.checkPrerequisites(); } catch (_) { state.prereq = null; }
  const pill = $('#provider-pill');
  const banner = $('#prereq-banner');
  const provider = (state.settings && state.settings.provider) || 'claude';
  const active = state.prereq ? state.prereq[provider] : null;
  const name = providerLabel(provider);
  const chain = currentChain();
  const chainNote = chain.length > 1 ? ` +${chain.length - 1} fallback` : '';

  const auth = state.authStatus && state.authStatus[provider];

  if (active && active.found) {
    if (!auth) {
      pill.className = 'pill'; // unknown yet — auth probe running
      pill.textContent = `● ${name} · checking sign-in…`;
      banner.classList.add('hidden');
    } else if (auth.signedIn) {
      pill.className = 'pill ok';
      pill.textContent = `● ${name} · signed in${chainNote}`;
      banner.classList.add('hidden');
    } else {
      pill.className = 'pill bad';
      pill.textContent = `● ${name} · not signed in`;
      banner.innerHTML = '';
      banner.append(
        h('span', { class: 'grow' }, `⚠️ ${name} is installed but not signed in. Sign in with your subscription to start writing.`),
        h('button', { class: 'btn btn-gold btn-sm', onClick: () => openAuthModal(provider) }, `🔑 Sign in to ${name}`),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheckAuth() }, 'Re-check'),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Hide until next check', onClick: () => banner.classList.add('hidden') }, '✕'));
      banner.classList.remove('hidden');
    }
  } else {
    pill.className = 'pill bad';
    pill.textContent = `● ${name} not found`;
    const others = (state.models.providers || [])
      .map((p) => p.id)
      .filter((id) => id !== provider && state.prereq && state.prereq[id] && state.prereq[id].found);
    banner.innerHTML = '';
    const msg = others.length
      ? `${name} isn’t set up. Sign in below, or use an engine you already have:`
      : `No AI engine is ready yet. Install any one of Claude Code, Codex, or Gemini and sign in with your own subscription — ChapterOne uses whichever you pick.`;
    banner.append(h('span', { class: 'grow' }, `⚠️ ${msg}`));
    for (const id of others) {
      banner.append(h('button', { class: 'btn btn-gold btn-sm', onClick: () => switchProvider(id) }, `Use ${providerLabel(id)}`));
    }
    const meta = providerMeta(provider);
    banner.append(
      meta.npmPackage ? h('button', { class: 'btn btn-gold btn-sm', onClick: () => openInstallModal(provider) }, `⬇ Install ${name}`) : null,
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal(provider) }, `🔑 Sign in to ${name}`),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('settings') }, 'Settings'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hide until next check', onClick: () => banner.classList.add('hidden') }, '✕'));
    banner.classList.remove('hidden');
  }
}
async function recheck() {
  await refreshPrereq();
  if (state.view === 'create') renderCreate();
  if (state.view === 'settings') renderSettings();
  refreshAuthStatus(); // background probe of sign-in state
}
/** Background probe of which installed CLIs are actually signed in. */
async function refreshAuthStatus() {
  try { state.authStatus = await api.getAuthStatus(); }
  catch (_) { state.authStatus = null; }
  await refreshPrereq();
  if (state.view === 'settings') renderSettings();
  if (state.view === 'create') renderCreate();
}
async function recheckAuth() {
  toast('Checking sign-in…');
  state.authStatus = null;
  await refreshPrereq();
  await refreshAuthStatus();
}
function authOf(id) { return (state.authStatus && state.authStatus[id]) || null; }

// ---------- shared engine controls ----------
function providerLabel(id) {
  const p = (state.models.providers || []).find((x) => x.id === id);
  return p ? p.label : id;
}
function modelField(provider) { return provider + 'Model'; }

function modelOptionsFor(provider) {
  const list = state.models[provider] || [];
  const field = modelField(provider);
  const current = state.settings[field] || '';
  const known = list.map((m) => m.id);
  const sel = h('select', { id: `eng-model-${provider}`, class: 'model-select' });
  for (const m of list) sel.append(h('option', { value: m.id, selected: m.id === current ? 'selected' : false }, m.label));
  if (current && !known.includes(current)) sel.append(h('option', { value: current, selected: 'selected' }, `Custom: ${current}`));
  sel.append(h('option', { value: '__custom__' }, 'Custom model…'));
  sel.addEventListener('change', async () => {
    if (sel.value === '__custom__') {
      const v = window.prompt(`Enter a custom model id for ${providerLabel(provider)}:`, current || '');
      if (v == null) { sel.value = current || ''; return; }
      await updateSettings({ [field]: v.trim() });
      renderEngineBarInPlace();
    } else {
      await updateSettings({ [field]: sel.value });
    }
  });
  return sel;
}

function toggle(id, checked, label, onChange) {
  const input = h('input', { type: 'checkbox', id });
  if (checked) input.checked = true;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }, h('span', { class: 'thumb' })), h('span', { class: 'switch-label' }, label));
}

/** Compute the ordered fallback chain from settings (primary first). */
function currentChain() {
  const s = state.settings;
  const ids = (state.models.providers || []).map((p) => p.id);
  const primary = s.provider || 'claude';
  const set = new Set(Array.isArray(s.chain) ? s.chain : [primary]);
  set.add(primary);
  const ordered = [primary, ...ids.filter((id) => id !== primary && set.has(id))];
  return [...new Set(ordered)];
}

async function setChain(ordered) {
  await updateSettings({ chain: ordered });
  renderEngineBarInPlace();
}

/** Ordered chain rows (each with a per-provider model picker) + add buttons. */
function chainBuilder() {
  const s = state.settings;
  const primary = s.provider || 'claude';
  const chain = currentChain();
  const ids = (state.models.providers || []).map((p) => p.id);
  const wrap = h('div', { class: 'chain-builder' });

  chain.forEach((pid, idx) => {
    const isPrimary = pid === primary;
    const row = h('div', { class: `chain-step ${isPrimary ? 'primary' : ''}` },
      h('span', { class: 'chain-order' }, String(idx + 1)),
      h('div', { class: 'chain-name' }, providerLabel(pid), isPrimary ? h('span', { class: 'chain-tag' }, 'primary') : null),
      modelOptionsFor(pid),
      h('button', { class: 'icon-btn', title: 'Sign in', onClick: () => openAuthModal(pid) }, '🔑'),
      isPrimary ? null : h('button', {
        class: 'icon-btn danger', title: 'Remove from chain',
        onClick: () => setChain(chain.filter((x) => x !== pid)),
      }, '✕'),
      isPrimary || idx <= 1 ? null : h('button', {
        class: 'icon-btn', title: 'Move up',
        onClick: () => { const a = chain.slice(); [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; setChain(a); },
      }, '↑'));
    wrap.append(row);
  });

  const addable = ids.filter((id) => !chain.includes(id));
  if (addable.length) {
    const add = h('div', { class: 'chain-add' }, h('span', { class: 'mini-label' }, 'Add fallback:'));
    for (const id of addable) {
      add.append(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => setChain([...chain, id]) }, `+ ${providerLabel(id)}`));
    }
    wrap.append(add);
  }
  return wrap;
}

/** Off / AI art / Stock photos segmented control. */
function hasImageKey() {
  return !!(state.settings.images && state.settings.images.geminiApiKey && state.settings.images.geminiApiKey.trim());
}
function imageModeControl() {
  const mode = state.settings.imageMode || 'off';
  const seg = h('div', { class: 'seg' });
  const opts = [
    { v: 'off', l: 'No images' },
    { v: 'nano', l: '🍌 Nano Banana (real AI art)' },
    { v: 'ai', l: '🎨 Vector art' },
    { v: 'stock', l: '📷 Stock photos' },
  ];
  for (const o of opts) {
    seg.append(h('button', { class: mode === o.v ? 'active' : '', onClick: () => updateSettings({ imageMode: o.v }).then(renderEngineBarInPlace) }, o.l));
  }
  const nanoNeedsKey = mode === 'nano' && !hasImageKey();
  const hint = mode === 'nano'
    ? (hasImageKey()
        ? 'Real, theme-matched illustrations generated with Google’s Nano Banana (Gemini image API). ~$0.13/image with the Pro model; density adapts to a kids book’s age. A cost estimate is shown before writing.'
        : 'Nano Banana needs your Gemini API key (image-only, separate from your CLI subscription).')
    : mode === 'ai'
      ? 'Your selected engine designs a bespoke vector cover and a chapter illustration that match the book’s theme — copyright-free.'
      : mode === 'stock'
        ? 'Sources high-resolution, openly-licensed photos from Openverse, with a credits page.'
        : 'No images will be added.';
  return h('div', { class: 'engine-col grow' },
    h('span', { class: 'mini-label' }, 'Cover & illustrations'),
    seg,
    h('span', { class: 'hint' }, hint),
    nanoNeedsKey ? h('button', { class: 'btn btn-gold btn-sm', style: 'margin-top:6px;align-self:flex-start', onClick: () => go('settings') }, '🔑 Add Gemini API key in Settings') : null);
}

function engineBar() {
  const s = state.settings;
  const provider = s.provider || 'claude';
  const seg = h('div', { class: 'seg' });
  for (const p of (state.models.providers || [])) {
    const found = !!(state.prereq && state.prereq[p.id] && state.prereq[p.id].found);
    const a = authOf(p.id);
    const signedIn = !!(a && a.signedIn);
    const cls = [provider === p.id ? 'active' : '', signedIn ? 'found' : (found ? 'warn' : '')].filter(Boolean).join(' ');
    const title = signedIn ? `${p.label}: signed in` : (found ? `${p.label}: installed, not signed in` : `${p.label}: not installed`);
    seg.append(h('button', { class: cls, title, onClick: () => switchProvider(p.id) }, h('span', { class: 'sdot' }), p.label));
  }
  const bar = h('div', { class: 'engine-bar card', id: 'engine-bar' },
    h('div', { class: 'engine-row' },
      h('div', { class: 'engine-col' },
        h('span', { class: 'mini-label' }, 'Primary engine'),
        seg)),
    h('div', { class: 'engine-row', style: 'margin-top:14px;flex-direction:column;align-items:stretch;gap:8px' },
      h('span', { class: 'mini-label' }, 'Engines, models & automatic fallback chain'),
      chainBuilder(),
      h('span', { class: 'hint' }, 'Writing runs top-to-bottom. If an engine’s quota runs out mid-book, it continues automatically on the next — pick a model for each.')),
    h('div', { class: 'engine-row', style: 'margin-top:14px' }, imageModeControl()),
    h('div', { class: 'engine-row toggles' },
      toggle('t-research', s.research, '🔎 Research real facts & sources (web)', (v) => updateSettings({ research: v })),
      toggle('t-polish', s.polish, '✨ Editor polish pass (higher quality)', (v) => updateSettings({ polish: v })),
      toggle('t-sub', s.forceSubscription, '🔐 Use subscription, not API key', (v) => updateSettings({ forceSubscription: v }))));
  return bar;
}
function renderEngineBarInPlace() {
  const old = $('#engine-bar');
  if (old) old.replaceWith(engineBar());
}
async function switchProvider(p) {
  // Primary becomes p, and is guaranteed first in the chain.
  const chain = new Set(currentChain());
  chain.add(p);
  const ids = (state.models.providers || []).map((x) => x.id);
  const ordered = [p, ...ids.filter((id) => id !== p && chain.has(id))];
  await updateSettings({ provider: p, chain: ordered });
  await refreshPrereq();
  renderEngineBarInPlace();
}

// ---------- guided sign-in modal ----------
function openAuthModal(provider) {
  const name = providerLabel(provider);
  const status = h('p', { class: 'hint' }, 'Opening Terminal…');
  const cmdLine = h('pre', { class: 'auth-log' }, '');
  let poll = null;
  let done = false;
  const close = () => { if (poll) clearInterval(poll); overlay.remove(); };

  async function succeed() {
    if (done) return; done = true;
    if (poll) clearInterval(poll);
    toast(`✅ Signed in to ${name}.`, 'ok');
    close();
    await recheckAuth();
  }

  async function recheck(btn) {
    if (btn) { btn.textContent = 'Checking…'; btn.setAttribute('disabled', 'true'); }
    const res = await api.checkAuth(provider).catch((e) => ({ ok: false, detail: e.message }));
    if (res.ok) await succeed();
    else {
      toast(`Not signed in yet: ${res.detail || 'finish sign-in in Terminal first'}`, 'bad');
      if (btn) { btn.textContent = '✓ I’ve finished — re-check'; btn.removeAttribute('disabled'); }
    }
  }

  // Auto-detect: poll sign-in occasionally so the user doesn't have to click
  // anything once they finish in Terminal/browser. Kept infrequent because each
  // check spawns the CLI (which on macOS reads its Keychain token), and we don't
  // want to trigger repeated permission prompts.
  let attempts = 0;
  poll = setInterval(async () => {
    if (done || attempts++ >= 12) { if (poll) clearInterval(poll); poll = null; return; }
    const res = await api.checkAuth(provider).catch(() => ({ ok: false }));
    if (res.ok) await succeed();
  }, 10000);

  const recheckBtn = h('button', { class: 'btn btn-gold btn-sm', onClick: (e) => recheck(e.currentTarget) }, '✓ I’ve finished — re-check');
  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 6px' }, `Sign in to ${name}`),
      status,
      h('p', { class: 'hint' }, 'A Terminal window opens running the sign-in command (a browser may open to authorize). Finish it there — ChapterOne detects success automatically. You can also click “I’ve finished” to check now.'),
      cmdLine,
      h('div', { class: 'btn-row' },
        recheckBtn,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => api.startAuth(provider).catch(() => {}) }, '↺ Reopen Terminal'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: close }, 'Close'))));
  document.body.append(overlay);

  api.startAuth(provider)
    .then((info) => {
      status.textContent = info.opened
        ? 'Terminal opened. Finish sign-in there, then click “I’ve finished”.'
        : 'Run this command in your terminal to sign in, then click “I’ve finished”:';
      cmdLine.textContent = `$ ${info.command}\n\n${info.hint || ''}`;
    })
    .catch((err) => { status.textContent = `Could not open Terminal: ${err.message}. Run the command below yourself:`; });
}

// ---------- one-click CLI install ----------
function providerMeta(id) { return (state.models.providers || []).find((p) => p.id === id) || {}; }

function openInstallModal(provider) {
  const label = providerLabel(provider);
  const meta = providerMeta(provider);
  const npmOk = !!(state.prereq && state.prereq.npm && state.prereq.npm.found);
  let unsub = null;
  let done = false;

  const log = h('pre', { class: 'auth-log' }, '');
  const append = (t) => { log.textContent += t; log.scrollTop = log.scrollHeight; };
  const startBtn = h('button', { class: 'btn btn-primary btn-sm', onClick: run }, `⬇ Install ${label}`);

  const close = () => { if (unsub) unsub(); overlay.remove(); };
  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 6px' }, `Install ${label}`),
      h('p', { class: 'hint' }, meta.npmPackage
        ? `This runs “npm install -g ${meta.npmPackage}”, then verifies it’s on your PATH. Afterwards you sign in with your own ${label} subscription — ChapterOne never uses an API key.`
        : `No automatic installer is available for ${label}.`),
      log,
      h('div', { class: 'btn-row' }, startBtn,
        meta.docsUrl ? h('a', { href: meta.docsUrl, class: 'btn btn-ghost btn-sm' }, 'Install docs') : null,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: close }, 'Close'))));
  document.body.append(overlay);

  if (!npmOk) {
    append('npm was not found on your PATH.\nChapterOne installs CLIs with npm, so install Node.js (which bundles npm) from https://nodejs.org first, then reopen this.\n');
    startBtn.setAttribute('disabled', 'true');
  }

  async function run() {
    if (done) return;
    startBtn.setAttribute('disabled', 'true');
    startBtn.textContent = 'Installing…';
    unsub = api.onInstallOutput((d) => { if (d.provider === provider) append(d.text); });
    try {
      const res = await api.installCli(provider);
      done = true;
      if (res && res.found) {
        startBtn.textContent = 'Installed ✓';
        toast(`✅ ${label} installed. Now sign in.`, 'ok');
        await refreshPrereq();
        if (state.view === 'settings') renderSettings();
        else if (state.view === 'create') renderCreate();
      } else {
        startBtn.removeAttribute('disabled'); startBtn.textContent = 'Retry';
        toast(`${label} install finished, but it’s still not detected.`, 'bad');
      }
    } catch (err) {
      append(`\nError: ${err.message}\n`);
      startBtn.removeAttribute('disabled'); startBtn.textContent = 'Retry install';
      toast(`Install failed: ${err.message}`, 'bad');
    }
  }
}

// ---------- LIBRARY ----------
async function renderLibrary() {
  const books = await api.listBooks().catch(() => []);
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'Your Library'),
    h('p', {}, 'Bestseller-grade books, written on demand and ready for Kindle.'));

  let body;
  if (!books.length) {
    body = h('div', { class: 'empty' },
      h('div', { class: 'big' }, '📖'),
      h('p', {}, "You haven't written a book yet."),
      h('button', { class: 'btn btn-primary', onClick: () => go('create') }, '✨ Write my first book'));
  } else {
    const grid = h('div', { class: 'book-grid' });
    for (const b of books) {
      const paused = b.status === 'paused';
      const statusLabel = b.status === 'generating' ? 'Writing…' : (paused ? 'Paused' : (b.status || 'draft'));
      const coverEl = b.cover
        ? h('div', { class: 'book-cover has-art' }, h('img', { src: b.cover, alt: '' }))
        : h('div', { class: 'book-cover', style: `background:${coverGradient(b.title)}` },
            h('h3', {}, b.title || 'Untitled'),
            h('div', { class: 'by' }, `by ${b.author || 'Anonymous'}`));
      const card = h('div', { class: 'book-card', onClick: () => go('reader', b.id) },
        coverEl,
        h('div', { class: 'book-meta' },
          h('div', { class: 'stat' },
            h('span', { class: `badge ${b.status}` }, statusLabel),
            h('span', {}, b.genre || '')),
          h('div', { class: 'stat', style: 'margin-top:8px' },
            h('span', {}, `${b.chapters}/${b.plannedChapters || b.chapters} ch`),
            h('span', {}, `${(b.words || 0).toLocaleString()} words`)),
          paused ? h('button', {
            class: 'btn btn-gold btn-sm', style: 'margin-top:12px;width:100%',
            onClick: (e) => { e.stopPropagation(); startResume(b.id); },
          }, '▶ Continue writing') : null));
      grid.append(card);
    }
    body = h('div', {},
      h('div', { class: 'btn-row', style: 'margin-bottom:20px' },
        h('button', { class: 'btn btn-primary', onClick: () => go('create') }, '✨ New Book')),
      grid);
  }
  mount(h('div', { class: 'view' }, head, body));
}

// ---------- CREATE ----------
function selectEl(id, options, selected) {
  const s = h('select', { id });
  for (const o of options) s.append(h('option', { value: o, selected: o === selected ? 'selected' : false }, o));
  return s;
}
function sizeSelect(selected) {
  const opts = [
    { v: 'small', l: 'Small — 35–60 pages' },
    { v: 'medium', l: 'Medium — 75–125 pages' },
    { v: 'large', l: 'Large — 150–250 pages' },
  ];
  const s = h('select', { id: 'f-size' });
  for (const o of opts) s.append(h('option', { value: o.v, selected: o.v === selected ? 'selected' : false }, o.l));
  return s;
}
function charactersEditor(values = []) {
  const list = h('div', { class: 'chars-list' });
  const addRow = (c = {}) => {
    const row = h('div', { class: 'char-row' },
      h('input', { class: 'char-name', placeholder: 'Name (e.g. Aanya)', value: c.name || '' }),
      h('input', { class: 'char-role', placeholder: 'Who they are (e.g. age 5, the brave hero who loves dinosaurs)', value: c.role || '' }),
      h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove', onClick: () => row.remove() }, '✕'));
    list.append(row);
  };
  (values || []).forEach((c) => addRow(c));
  return h('div', { class: 'chars-editor', id: 'chars-editor' },
    h('span', { class: 'mini-label' }, 'Characters (optional) — make it personal'),
    h('span', { class: 'hint', style: 'margin:0 0 8px' }, 'Add real people (your child, family, friends) and who they are. The book will star them by name.'),
    list,
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'align-self:flex-start;margin-top:8px', onClick: () => addRow({}) }, '+ Add character'));
}
function readCharacters() {
  const out = [];
  document.querySelectorAll('#chars-editor .char-row').forEach((r) => {
    const name = r.querySelector('.char-name').value.trim();
    const role = r.querySelector('.char-role').value.trim();
    if (name) out.push({ name, role });
  });
  return out;
}

function kindSelect(selected) {
  const opts = [
    { v: '', l: 'Let the author decide' },
    { v: 'fiction', l: '📖 Fiction — a story' },
    { v: 'nonfiction', l: '📘 Non-fiction — real / how-to' },
  ];
  const s = h('select', { id: 'f-kind' });
  for (const o of opts) s.append(h('option', { value: o.v, selected: o.v === (selected || '') ? 'selected' : false }, o.l));
  return s;
}
function specForm(values = {}) {
  const v = values;
  return h('div', { class: 'card' },
    h('label', { class: 'field' },
      h('span', {}, 'What do you want to read? Describe the book you wish existed.'),
      h('textarea', { id: 'f-request', placeholder: 'e.g. A slow-burn cozy mystery set in a snowbound Scottish bakery, with a sharp-witted amateur sleuth and a cast of lovable suspects.' }, v.request || '')),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Type'),
        kindSelect(v.kind)),
      h('label', { class: 'field' }, h('span', {}, 'Genre'),
        h('input', { id: 'f-genre', placeholder: 'Mystery, Sci-Fi, Self-help…', value: v.genre || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Target audience'),
        h('input', { id: 'f-audience', placeholder: 'Adults, YA, professionals…', value: v.audience || '' }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Book size'),
        sizeSelect(v.size || (state.settings && state.settings.size) || 'medium')),
      h('label', { class: 'field' }, h('span', {}, 'Tone / style'),
        h('input', { id: 'f-tone', placeholder: 'Warm & witty, dark & gritty…', value: v.tone || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Author name (optional)'),
        h('input', { id: 'f-author', placeholder: 'Your name, or blank for a pen name', value: v.authorName != null ? v.authorName : ((state.settings && state.settings.authorName) || '') }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Point of view (optional)'),
        h('input', { id: 'f-pov', placeholder: 'First person, third limited…', value: v.pov || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Anything else? (optional)'),
        h('input', { id: 'f-notes', placeholder: 'Must-haves, inspirations, no-gos…', value: v.notes || '' }))),
    charactersEditor(v.characters));
}
function readSpec() {
  const s = state.settings;
  return {
    request: $('#f-request').value.trim(),
    kind: $('#f-kind').value,
    genre: $('#f-genre').value.trim(),
    audience: $('#f-audience').value.trim(),
    size: $('#f-size').value,
    tone: $('#f-tone').value.trim(),
    pov: $('#f-pov').value.trim(),
    notes: $('#f-notes').value.trim(),
    authorName: $('#f-author') ? $('#f-author').value.trim() : '',
    characters: readCharacters(),
    model: s[modelField(s.provider || 'claude')] || '',
    research: !!s.research,
    imageMode: s.imageMode || 'off',
    polish: s.polish !== false,
  };
}

function renderCreate() {
  const provider = (state.settings && state.settings.provider) || 'claude';
  const ready = state.prereq && state.prereq[provider] && state.prereq[provider].found;
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'Commission a new book'),
    h('p', {}, 'Pick your engine and model, then tell the bestselling author what you want. Vague is fine — they’ll ask smart questions first.'));

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', id: 'btn-clarify', onClick: onClarify }, ready ? 'Continue →' : 'CLI not ready'),
    h('button', { class: 'btn btn-ghost', onClick: () => skipToGenerate() }, 'Skip questions & write now'));

  mount(h('div', { class: 'view' }, head, engineBar(), specForm(state.draftSpec || {}), actions));
  if (!ready) $('#btn-clarify').setAttribute('disabled', 'true');
}

// ---------- KIDS BOOKS ----------
const KIDS_AGES = [
  ['1-2', 'Ages 1–2 · Baby / Board book'],
  ['3-5', 'Ages 3–5 · Picture book'],
  ['6-8', 'Ages 6–8 · Early reader'],
  ['9-12', 'Ages 9–12 · Middle grade'],
  ['13-16', 'Ages 13–16 · Young adult'],
  ['17-18', 'Ages 17–18 · Upper YA'],
];
function renderKidsCreate() {
  const provider = (state.settings && state.settings.provider) || 'claude';
  const ready = state.prereq && state.prereq[provider] && state.prereq[provider].found;
  const v = state.kidsDraft || {};
  const head = h('div', { class: 'page-head' },
    h('h1', {}, '🧸 New Kids Book'),
    h('p', {}, 'Pick the child’s age — fonts, length, vocabulary, safety, and illustration density all adapt. Add their name to make them the hero.'));

  const ageSel = h('select', { id: 'k-age' });
  KIDS_AGES.forEach(([val, label]) => ageSel.append(h('option', { value: val, selected: (v.ageBand || '6-8') === val ? 'selected' : false }, label)));
  const lenSel = h('select', { id: 'k-length' });
  [['short', 'Short'], ['standard', 'Standard'], ['long', 'Long']].forEach(([val, label]) => lenSel.append(h('option', { value: val, selected: (v.kidsLength || 'standard') === val ? 'selected' : false }, label)));

  const form = h('div', { class: 'card' },
    h('label', { class: 'field' }, h('span', {}, 'What should the story be about?'),
      h('textarea', { id: 'k-request', placeholder: 'e.g. A shy little dragon who is scared of the dark — until she discovers her fire can light up the whole forest.' }, v.request || '')),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Child’s age'), ageSel),
      h('label', { class: 'field' }, h('span', {}, 'Length'), lenSel),
      h('label', { class: 'field' }, h('span', {}, 'Kind of story (optional)'),
        h('input', { id: 'k-genre', placeholder: 'Bedtime, adventure, learning, fairy tale…', value: v.genre || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Author name (optional)'),
        h('input', { id: 'k-author', placeholder: 'Your name, or blank for a pen name', value: v.authorName != null ? v.authorName : ((state.settings && state.settings.authorName) || '') }))),
    charactersEditor(v.characters));

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', id: 'btn-kids-go', onClick: onKidsGenerate }, ready ? '✨ Write the kids book' : 'CLI not ready'));

  mount(h('div', { class: 'view' }, head, engineBar(), form, actions));
  if (!ready) $('#btn-kids-go').setAttribute('disabled', 'true');
}
function readKidsSpec() {
  const s = state.settings;
  return {
    request: $('#k-request').value.trim(),
    ageBand: $('#k-age').value,
    kidsLength: $('#k-length') ? $('#k-length').value : 'standard',
    genre: $('#k-genre').value.trim(),
    authorName: $('#k-author') ? $('#k-author').value.trim() : '',
    characters: readCharacters(),
    isKids: true,
    model: s[modelField(s.provider || 'claude')] || '',
    research: !!s.research,
    imageMode: s.imageMode || 'off',
    polish: s.polish !== false,
  };
}
function onKidsGenerate() {
  const spec = readKidsSpec();
  if (!spec.request) { toast('Tell me what the story should be about first.', 'bad'); return; }
  state.kidsDraft = spec;
  beginGeneration(spec, {});
}

async function onClarify() {
  const spec = readSpec();
  if (!spec.request) { toast('Describe what you want to read first.', 'bad'); return; }
  state.draftSpec = spec;
  const btn = $('#btn-clarify');
  btn.setAttribute('disabled', 'true');
  btn.textContent = 'Thinking…';
  try {
    state.clarify = await api.clarify(spec);
    if (state.clarify.needsClarification && state.clarify.questions.length) go('clarify');
    else beginGeneration(spec, {});
  } catch (err) {
    toast(`Could not reach the model: ${err.message}`, 'bad');
    btn.removeAttribute('disabled');
    btn.textContent = 'Continue →';
  }
}
function skipToGenerate() {
  const spec = readSpec();
  if (!spec.request) { toast('Describe what you want to read first.', 'bad'); return; }
  state.draftSpec = spec;
  beginGeneration(spec, {});
}

// ---------- CLARIFY ----------
function renderClarify() {
  const c = state.clarify;
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'A few quick questions'),
    h('p', {}, c.summary || 'Answering these helps craft a sharper, more on-target book.'));

  const card = h('div', { class: 'card' });
  c.questions.forEach((q, i) => {
    const inputId = `clar-${i}`;
    const block = h('div', { class: 'q-block' },
      h('div', { class: 'q' }, q.question),
      q.why ? h('div', { class: 'why' }, q.why) : null);
    if (Array.isArray(q.suggestions) && q.suggestions.length) {
      const chips = h('div', { class: 'chips' });
      q.suggestions.forEach((sg) =>
        chips.append(h('button', { class: 'chip', onClick: () => { $('#' + inputId).value = sg; } }, sg)));
      block.append(chips);
    }
    block.append(h('input', { id: inputId, 'data-q': q.id || q.question, placeholder: 'Your answer (optional)' }));
    card.append(block);
  });

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-gold', onClick: () => {
      const answers = {};
      document.querySelectorAll('[id^="clar-"]').forEach((inp) => {
        if (inp.value.trim()) answers[inp.getAttribute('data-q')] = inp.value.trim();
      });
      beginGeneration(state.draftSpec, answers);
    } }, '✍️ Write the book'),
    h('button', { class: 'btn btn-ghost', onClick: () => go('create') }, '← Back'));

  mount(h('div', { class: 'view' }, head, card, actions));
}

// ---------- GENERATION / RESUME ----------
function newJob(spec) {
  return {
    jobId: `job-${Date.now()}`, spec, phase: 'starting', chapters: [], outline: [],
    title: (spec && spec.request || 'Book').slice(0, 40), bookId: null, error: null, done: false,
    activity: '', activityLog: [], stream: '', streamCh: null, engine: (spec && spec.provider) || null,
    startedAt: Date.now(),
  };
}
function logActivity(j, icon, text) {
  j.activityLog.push({ t: Date.now(), icon, text });
  if (j.activityLog.length > 120) j.activityLog.shift();
}
/** Confirm Nano Banana image cost before writing. Resolves true to proceed. */
function confirmNanoCost(spec) {
  return new Promise((resolve) => {
    const body = h('p', { class: 'hint', style: 'margin-bottom:14px' }, 'Estimating…');
    const proceed = h('button', { class: 'btn btn-primary btn-sm', onClick: () => { overlay.remove(); resolve(true); } }, 'Yes, illustrate it');
    const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } } },
      h('div', { class: 'modal', style: 'max-width:460px' },
        h('h2', { style: 'margin:0 0 6px' }, '🍌 Generate illustrations with Nano Banana?'),
        body,
        h('div', { class: 'btn-row' }, proceed,
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { overlay.remove(); resolve(false); } }, 'Cancel'))));
    document.body.append(overlay);
    api.estimateImages(spec).then((est) => {
      body.textContent = `This will create ${est.approximate ? 'about ' : ''}~${est.count} illustration${est.count === 1 ? '' : 's'} with ${est.modelLabel} ≈ $${est.cost}. Images are billed by Google to your own Gemini API key.`;
    }).catch(() => { body.textContent = 'Nano Banana will illustrate this book (billed to your Gemini API key).'; });
  });
}

/** Generic confirm modal. Resolves true on confirm, false on cancel/dismiss. */
function confirmDialog(title, message, okLabel) {
  return new Promise((resolve) => {
    const body = h('p', { class: 'hint', style: 'margin-bottom:14px;white-space:pre-wrap' }, message || '');
    const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } } },
      h('div', { class: 'modal', style: 'max-width:480px' },
        h('h2', { style: 'margin:0 0 6px' }, title),
        body,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary btn-sm', onClick: () => { overlay.remove(); resolve(true); } }, okLabel || 'Continue'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { overlay.remove(); resolve(false); } }, 'Cancel'))));
    document.body.append(overlay);
  });
}

/** Entry point for all generation: gates Nano Banana on key + cost confirmation. */
async function beginGeneration(spec, answers) {
  // Remember the author name so future books default to it.
  if (spec && spec.authorName) { try { await updateSettings({ authorName: spec.authorName }); } catch (_) { /* non-fatal */ } }
  if (spec.imageMode === 'nano') {
    if (!hasImageKey()) {
      toast('Add a Gemini API key in Settings to use Nano Banana, or choose another image option.', 'bad');
      return go('settings');
    }
    const ok = await confirmNanoCost(spec);
    if (!ok) return;
  }
  startGeneration(spec, answers);
}

function startGeneration(spec, answers) {
  state.job = newJob(spec);
  const j = state.job;
  go('progress');
  const off = api.onProgress((e) => { if (e.jobId === j.jobId) handleProgress(e); });
  api.generate(spec, answers, j.jobId)
    .then((res) => { j.bookId = res.id; j.done = true; redrawProgress(); toast('🎉 Your book is ready!', 'ok'); })
    .catch((err) => { j.error = err.message; redrawProgress(); toast(`Writing paused: ${err.message}`, 'bad'); })
    .finally(() => off && off());
}
function startResume(id) {
  state.job = newJob({ request: 'Resuming…' });
  const j = state.job;
  j.bookId = id;
  j.resuming = true;
  go('progress');
  const off = api.onProgress((e) => { if (e.jobId === j.jobId) handleProgress(e); });
  api.resumeBook(id, j.jobId)
    .then((res) => { j.bookId = res.id; j.done = true; redrawProgress(); toast('🎉 Book completed!', 'ok'); })
    .catch((err) => { j.error = err.message; redrawProgress(); toast(`Writing paused again: ${err.message}`, 'bad'); })
    .finally(() => off && off());
}
function redrawProgress() { if (state.view === 'progress') renderProgress(); }

function handleProgress(e) {
  const j = state.job;
  if (!j) return;
  j.phase = e.phase;
  switch (e.phase) {
    case 'influences:start': j.activity = e.message || 'Studying the best authors…'; logActivity(j, '📚', 'Studying the category’s best authors to learn — and surpass — them…'); break;
    case 'influences:done':
      if (e.authors && e.authors.length) { j.influences = e.authors; logActivity(j, '🎓', `Learned from ${e.authors.join(', ')} — now aiming higher`); }
      else logActivity(j, '🎓', 'Proceeding with master-level craft'); break;
    case 'outline:start': logActivity(j, '🗂️', 'Designing the book concept & chapter outline…'); break;
    case 'outline:done':
    case 'resume':
      if (e.book) { j.title = e.book.title || j.title; j.outline = e.book.outline || []; j.bookId = e.book.id; j.chapters = (e.book.chapters || []).map((c) => c && { number: c.number, title: c.title, words: c.words }); }
      if (e.phase === 'outline:done') logActivity(j, '✅', `Outline ready — ${j.outline.length} chapters planned`);
      else logActivity(j, '▶️', `Resuming from chapter ${(e.startIndex || 0) + 1}`);
      break;
    case 'cover:start': j.activity = 'Designing the cover…'; logActivity(j, '🎨', 'Designing the book cover'); break;
    case 'cover:done': logActivity(j, '🖼️', 'Cover designed'); if (e.book && e.book.coverSvg) j.coverSvg = e.book.coverSvg; break;
    case 'chapter:start':
      j.activeIndex = e.index; j.streamCh = e.index; j.stream = '';
      j.activity = e.message || `Writing Chapter ${e.number}`;
      logActivity(j, '✍️', `Chapter ${e.number}: ${e.title} — drafting`);
      break;
    case 'chapter:stream':
      if (e.index === j.streamCh) j.stream = e.preview || '';
      break;
    case 'chapter:polish':
      j.activity = e.message || `Polishing Chapter ${e.number}`;
      logActivity(j, '✨', `Chapter ${e.number}: editor polish pass`);
      break;
    case 'art:start': j.activity = e.message || 'Illustrating…'; logActivity(j, '🎨', `Chapter ${e.number}: creating illustration`); break;
    case 'art:done': logActivity(j, '🖼️', `Chapter ${e.number}: illustration ready`); break;
    case 'image:error': j.activity = e.message; logActivity(j, '⚠️', e.message || 'Image generation issue'); toast(e.message || 'Image generation issue', 'bad'); break;
    case 'chapter:done':
      j.chapters[e.index] = { number: e.number, title: e.title, words: e.words };
      j.activeIndex = e.index + 1; j.stream = ''; j.streamCh = null;
      logActivity(j, '✅', `Chapter ${e.number}: ${e.title} — done (${(e.words || 0).toLocaleString()} words)`);
      break;
    case 'images':
      if (e.query) { j.activity = `Finding image: “${e.query}”`; logActivity(j, '🔎', `Sourcing image: ${e.query}`); }
      break;
    case 'engine:switch':
      if (e.type === 'falling-back') { j.activity = `⚠️ ${providerLabel(e.fromId)} hit a ${e.kind} limit — switching to ${providerLabel(e.toId)}…`; logActivity(j, '🔁', j.activity); toast(j.activity, 'bad'); }
      else if (e.type === 'switched') { j.engine = e.toId; logActivity(j, '✅', `Now writing with ${providerLabel(e.toId)}`); }
      else if (e.type === 'exhausted') { logActivity(j, '⛔', `All engines in the chain failed (${e.kind})`); }
      break;
    case 'complete': logActivity(j, '🎉', 'Book complete'); break;
    default: break;
  }
  if (e.message) j.message = e.message;
  redrawProgress();
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
function statCard(label, value, id) {
  return h('div', { class: 'stat-card' }, h('div', { class: 'stat-val', id: id || false }, value), h('div', { class: 'stat-label' }, label));
}

function renderProgress() {
  const j = state.job;
  if (!j) return go('library');
  const total = j.outline.length;
  const doneCount = j.chapters.filter(Boolean).length;
  const pct = total ? Math.round((doneCount / total) * 100) : (j.phase === 'starting' ? 6 : 12);
  const working = !j.done && !j.error;
  const wordsSoFar = j.chapters.reduce((n, c) => n + ((c && c.words) || 0), 0);

  const head = h('div', { class: 'progress-head' },
    working ? h('div', { class: 'spinner' }) : h('div', { style: 'font-size:26px' }, j.error ? '⏸️' : '🎉'),
    h('div', { style: 'flex:1' },
      h('h1', { style: 'margin:0;font-size:22px' }, j.done ? j.title : (j.error ? 'Writing paused' : 'Writing your book…')),
      h('p', { style: 'margin:4px 0 0;color:var(--text-dim);font-size:14px' },
        j.error ? j.error : (j.activity || j.message || 'Working with the bestselling author…'))));

  const bar = h('div', { class: 'progress-bar' }, h('div', { style: `width:${pct}%` }));

  const stats = h('div', { class: 'stat-row' },
    statCard('Chapters', `${doneCount}/${total || '—'}`),
    statCard('Words written', wordsSoFar.toLocaleString(), 'stat-words'),
    statCard('Elapsed', fmtElapsed(Date.now() - j.startedAt), 'stat-elapsed'),
    statCard('Engine', providerLabel(j.engine || (j.spec && j.spec.provider) || 'claude')));

  // live writing preview
  let preview = null;
  if (working && j.stream) {
    preview = h('div', { class: 'live-preview card' },
      h('div', { class: 'live-head' }, h('span', { class: 'live-dot' }), 'Live draft',
        j.streamCh != null && j.outline[j.streamCh] ? h('span', { class: 'live-ch' }, `Chapter ${j.outline[j.streamCh].number}: ${j.outline[j.streamCh].title}`) : null),
      h('div', { class: 'live-text' }, j.stream, h('span', { class: 'live-cursor' }, '▍')));
  }

  // chapter checklist
  const list = h('ul', { class: 'chapter-list' });
  if (j.outline.length) {
    j.outline.forEach((c, i) => {
      const done = !!j.chapters[i];
      const active = !done && i === j.activeIndex && working;
      list.append(h('li', { class: done ? 'done' : (active ? 'active' : '') },
        h('span', { class: 'ci' }, done ? '✓' : (active ? '✍️' : '·')),
        h('span', {}, c.title),
        done && j.chapters[i].words ? h('span', { style: 'margin-left:auto;font-size:12px;color:var(--text-dim)' }, `${j.chapters[i].words.toLocaleString()} w`) : null));
    });
  } else {
    list.append(h('li', { class: 'active' }, h('span', { class: 'ci' }, '✍️'), 'Designing the outline…'));
  }

  // live activity feed
  const feed = h('div', { class: 'activity-feed' });
  j.activityLog.slice(-40).reverse().forEach((a) => {
    feed.append(h('div', { class: 'activity-item' },
      h('span', { class: 'a-ico' }, a.icon),
      h('span', { class: 'a-text' }, a.text),
      h('span', { class: 'a-time' }, new Date(a.t).toLocaleTimeString())));
  });

  const actions = h('div', { class: 'btn-row', style: 'margin-top:22px' });
  if (j.done && j.bookId) {
    actions.append(h('button', { class: 'btn btn-gold', onClick: () => go('reader', j.bookId) }, '📖 Read it now'));
  } else if (j.error) {
    if (j.bookId) actions.append(h('button', { class: 'btn btn-gold', onClick: () => startResume(j.bookId) }, '▶ Continue from here'));
    actions.append(
      j.bookId ? h('button', { class: 'btn btn-ghost', onClick: () => go('reader', j.bookId) }, 'Open partial draft') : null,
      h('button', { class: 'btn btn-ghost', onClick: () => go('library') }, '← Library'));
  } else {
    actions.append(h('button', { class: 'btn btn-danger', onClick: async () => { await api.cancelGeneration(j.jobId); toast('Stopping…'); } }, 'Pause / Cancel'));
  }

  mount(h('div', { class: 'view' },
    head, bar, stats,
    preview,
    h('div', { class: 'progress-grid' },
      h('div', { class: 'card' }, h('p', { class: 'section-title' }, total ? `Chapters · ${doneCount} of ${total}` : 'Preparing'), list),
      h('div', { class: 'card' }, h('p', { class: 'section-title' }, 'Live activity'), feed)),
    actions));

  // tick the elapsed clock without re-rendering the whole view
  if (state.progressTimer) clearInterval(state.progressTimer);
  if (working) {
    state.progressTimer = setInterval(() => {
      const el = document.getElementById('stat-elapsed');
      if (el && state.view === 'progress') el.textContent = fmtElapsed(Date.now() - j.startedAt);
      else { clearInterval(state.progressTimer); state.progressTimer = null; }
    }, 1000);
  }
}

// ---------- READER (premium built-in EPUB reader) ----------
const READER_DEFAULTS = { fontSize: 19, family: 'serif', theme: 'sepia', mode: 'chapter' };
function readerPrefs() {
  try { return { ...READER_DEFAULTS, ...JSON.parse(localStorage.getItem('bw.reader.prefs') || '{}') }; }
  catch (_) { return { ...READER_DEFAULTS }; }
}
function saveReaderPrefs(p) { localStorage.setItem('bw.reader.prefs', JSON.stringify(p)); }
function readerPos(id) { return Number(localStorage.getItem('bw.reader.pos.' + id) || 0); }
function saveReaderPos(id, idx) { localStorage.setItem('bw.reader.pos.' + id, String(idx)); }

async function renderReader(id) {
  if (state.readerKeys) { document.removeEventListener('keydown', state.readerKeys); state.readerKeys = null; }
  let content;
  try { content = await api.getBookContent(id); }
  catch (err) { toast(`Could not open book: ${err.message}`, 'bad'); return go('library'); }

  const chapters = content.chapters || [];
  const paused = content.status === 'paused';
  const prefs = readerPrefs();
  // Kids books open at their age-appropriate type size.
  if (content.isKids && content.readerFontPx) prefs.fontSize = content.readerFontPx;

  // Front matter first: the cover is its own opening page, then a title/preface
  // page, then the chapters. The reader navigates this combined `pages` list.
  const pages = [];
  if (content.cover) pages.push({ kind: 'cover', label: 'Cover' });
  pages.push({ kind: 'preface', label: 'Title page' });
  chapters.forEach((c, i) => pages.push({ kind: 'chapter', label: c.title, number: c.number, chIndex: i, html: c.html }));
  const curChapterIndex = () => (pages[cur] && pages[cur].kind === 'chapter' ? pages[cur].chIndex : -1);

  let cur = Math.min(Math.max(readerPos(id), 0), Math.max(pages.length - 1, 0));

  // --- root + bar ---
  const root = h('div', { class: 'view reader-view epub-reader' });
  const setVars = () => {
    root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-font', prefs.family);
    if (content.ageBand) root.setAttribute('data-age', content.ageBand);
    root.style.setProperty('--reader-fs', prefs.fontSize + 'px');
  };

  const tocDrawer = h('aside', { class: 'toc-drawer' });
  const contentEl = h('div', { class: 'reader-content' });
  const progressFill = h('div', { class: 'rf' });
  const pageInfo = h('span', { class: 'page-info' }, '');

  const toggleToc = () => tocDrawer.classList.toggle('open');

  // --- audiobook player (ElevenLabs): per-chapter, on-demand, voice-swappable ---
  const audioCfg = (state.settings && state.settings.audio) || {};
  const audioReady = !!(audioCfg.elevenApiKey && (audioCfg.voiceId || audioCfg.voiceIdKids));
  const bookVoiceDefault = (content.isKids && audioCfg.voiceIdKids) ? audioCfg.voiceIdKids : audioCfg.voiceId;
  let selectedVoice = bookVoiceDefault || '';

  const audioEl = h('audio', { controls: 'controls', class: 'reader-audio', style: 'display:none' });
  const audioSpin = h('span', { class: 'spinner', style: 'width:16px;height:16px;border-width:2px;display:none' });
  const audioLabel = h('span', { class: 'audio-label', id: 'audio-label' }, audioReady ? 'Pick a voice, then Listen' : '🎧');
  const voiceSel = h('select', { class: 'reader-select', title: 'Narration voice', style: 'max-width:150px' }, h('option', { value: selectedVoice || '' }, 'Loading voices…'));
  voiceSel.addEventListener('change', () => { selectedVoice = voiceSel.value; });
  const speakerSel = deviceSelect('audiooutput', audioPrefs.speaker, async (v) => { audioPrefs.speaker = v; await applySink(audioEl); }, '🔊 Default speaker');
  speakerSel.title = 'Output speaker';
  // Unmask the full, named speaker list up front when the mic is already granted.
  ensureDeviceLabels().then(() => speakerSel._refresh && speakerSel._refresh());
  const listenBtn = h('button', { class: 'btn btn-gold btn-sm', title: 'Narrate this chapter with the selected voice', onClick: () => playChapterAudio(false) }, '🎧 Listen');
  const regenBtn = h('button', { class: 'btn btn-ghost btn-sm', title: 'Regenerate this chapter with the selected voice', onClick: () => playChapterAudio(true) }, '🔁');
  // The secondary controls live in one group so they can collapse together while
  // the chapter is playing — that gives the scrubber the full width of the bar.
  const audioOptions = h('div', { class: 'audio-options' },
    h('span', { class: 'mini-label', style: 'white-space:nowrap' }, 'Narration'),
    voiceSel, listenBtn, regenBtn, speakerSel,
    h('button', { class: 'btn btn-ghost btn-sm', title: 'Save this chapter as MP3', onClick: () => exportChapterAudio() }, '⤓ MP3'),
    h('button', { class: 'btn btn-ghost btn-sm', title: 'Narrate the whole book into one MP3', onClick: () => generateFullAudiobook() }, '📖 Whole book'));
  const optsBtn = h('button', { class: 'icon-btn opts-btn', title: 'Show narration options', onClick: (e) => { e.stopPropagation(); audioBar.classList.toggle('compact'); } }, '⋯ Options');
  const audioBar = h('div', { class: 'audio-bar' + (audioReady ? '' : ' hidden') },
    optsBtn, audioOptions, audioSpin, audioLabel, audioEl,
    h('button', { class: 'icon-btn', title: 'Hide player', onClick: (e) => { e.stopPropagation(); audioEl.pause(); audioBar.classList.add('hidden'); } }, '✕'));
  // Auto-expand the scrubber while playing (collapse the options); a click on the
  // bar (anywhere that isn't a control) — or the "⋯ Options" button — brings them back.
  audioEl.addEventListener('play', () => audioBar.classList.add('compact'));
  audioBar.addEventListener('click', (e) => {
    if (e.target.closest('audio, button, select, input')) return;
    audioBar.classList.remove('compact');
  });
  let audioBusy = false;
  const setSpin = (on) => { audioSpin.style.display = on ? 'inline-block' : 'none'; };

  // Populate the voice picker from the user's account (includes cloned voices).
  function populateReaderVoices(voices) {
    if (!voices || !voices.length) { return; }
    const recFlag = content.isKids ? 'recKids' : 'recAdult';
    if (!voices.some((v) => v.voice_id === selectedVoice)) {
      selectedVoice = (bookVoiceDefault && voices.some((v) => v.voice_id === bookVoiceDefault)) ? bookVoiceDefault : voices[0].voice_id;
    }
    const opt = (v) => h('option', { value: v.voice_id, selected: v.voice_id === selectedVoice ? 'selected' : false }, `${v[recFlag] ? '★ ' : ''}${v.name}`);
    voiceSel.innerHTML = '';
    const rec = voices.filter((v) => v[recFlag]);
    const rest = voices.filter((v) => !v[recFlag]);
    if (rec.length) { const og = h('optgroup', { label: '★ Recommended' }); rec.forEach((v) => og.append(opt(v))); voiceSel.append(og); }
    if (rest.length) { const og = h('optgroup', { label: 'All voices' }); rest.forEach((v) => og.append(opt(v))); voiceSel.append(og); }
    voiceSel.value = selectedVoice;
    audioLabel.textContent = 'Pick a voice, then Listen';
  }
  if (audioReady) api.listVoices().then(populateReaderVoices).catch(() => { voiceSel.innerHTML = ''; voiceSel.append(h('option', { value: selectedVoice || '' }, 'Default voice')); });

  async function playChapterAudio(force) {
    const a = state.settings && state.settings.audio;
    if (!a || !a.elevenApiKey) { toast('Add your ElevenLabs key and pick a voice in Settings → Audiobook.', 'bad'); return go('settings'); }
    const voice = selectedVoice || (content.isKids && a.voiceIdKids ? a.voiceIdKids : a.voiceId);
    if (!voice) { toast('Pick a narration voice.', 'bad'); return; }
    const ci = curChapterIndex();
    if (ci < 0) { toast('Open a chapter first, then press Listen.', 'bad'); return; }
    if (audioBusy) return;
    audioBusy = true;
    audioBar.classList.remove('hidden');
    audioEl.style.display = 'none';
    setSpin(true);
    audioLabel.textContent = force ? 'Regenerating…' : 'Preparing narration…';
    const off = api.onAudioProgress((p) => {
      if (p.id !== id || p.index !== ci) return;
      audioLabel.textContent = p.total ? `Narrating ch ${ci + 1}… ${p.done}/${p.total}` : 'Narrating…';
    });
    try {
      const res = await api.synthChapter(id, ci, voice, !!force);
      if (audioEl._url) { URL.revokeObjectURL(audioEl._url); audioEl._url = null; }
      audioEl._url = URL.createObjectURL(dataUriToBlob(res.dataUri));
      audioEl.src = audioEl._url;
      audioEl.style.display = '';
      setSpin(false);
      audioLabel.textContent = `🎧 ${res.title}`;
      await applySink(audioEl);
      audioEl.play().catch(() => {});
      toast(res.cached ? '▶ Loaded from cache (no charge).' : '✅ Narrated & saved — re-listens are free.', 'ok');
    } catch (err) {
      setSpin(false);
      toast(`Narration failed: ${err.message}`, 'bad');
    } finally { off && off(); audioBusy = false; }
  }
  async function exportChapterAudio() {
    const ci = curChapterIndex();
    if (ci < 0) { toast('Open a chapter first.', 'bad'); return; }
    try {
      const r = await api.exportAudio(id, ci, selectedVoice || undefined);
      if (r && !r.canceled) { toast('Saved chapter MP3.', 'ok'); await api.openPath(r.path); }
    } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
  }
  // When the chapter changes, stop the old audio and prompt for the new one so
  // narration is unmistakably per-chapter (no stale audio lingering).
  function resetAudioForNewChapter() {
    try { audioEl.pause(); } catch (_) { /* ignore */ }
    audioEl.style.display = 'none'; setSpin(false);
    audioBar.classList.remove('compact'); // show the options again for the new chapter
    if (audioBar.classList.contains('hidden')) return;
    const pg = pages[cur];
    audioLabel.textContent = pg && pg.kind === 'chapter' ? `Press 🎧 Listen for Chapter ${pg.chIndex + 1}` : 'Open a chapter to listen';
  }
  // Narrate the ENTIRE book into one MP3 file. Warns about cost/time first,
  // reuses already-narrated chapters for free, and saves wherever the user picks.
  async function generateFullAudiobook() {
    const a = state.settings && state.settings.audio;
    if (!a || !a.elevenApiKey) { toast('Add your ElevenLabs key and pick a voice in Settings → Audiobook.', 'bad'); return go('settings'); }
    const voice = selectedVoice || (content.isKids && a.voiceIdKids ? a.voiceIdKids : a.voiceId);
    if (!voice) { toast('Pick a narration voice first.', 'bad'); return; }
    if (!chapters.length) { toast('This book has no chapters yet.', 'bad'); return; }
    if (audioBusy) return;
    const voiceName = (voiceSel.selectedOptions[0] && voiceSel.selectedOptions[0].textContent.replace(/^★ /, '')) || 'the selected voice';
    const chars = chapters.reduce((n, c) => n + Math.round((c.words || 0) * 6), 0);
    const ok = await confirmDialog(
      '📖 Generate the whole audiobook?',
      `This narrates all ${chapters.length} chapter${chapters.length === 1 ? '' : 's'} in ${voiceName} and stitches them into a single MP3.\n\n` +
      `• It uses roughly ${chars.toLocaleString()} characters of your ElevenLabs quota (chapters you've already narrated with this voice are reused for free).\n` +
      `• It can take a few minutes for a long book, and it can't be paused once started.\n\n` +
      `You'll choose where to save the file next.`,
      'Generate audiobook');
    if (!ok) return;
    audioBusy = true;
    audioBar.classList.remove('hidden');
    audioEl.style.display = 'none';
    setSpin(true);
    audioLabel.textContent = 'Building audiobook…';
    const off = api.onFullAudioProgress((p) => {
      if (p.id !== id) return;
      if (p.done >= p.total) { audioLabel.textContent = 'Finishing audiobook…'; return; }
      const part = p.chunk && p.chunk.total ? ` (${p.chunk.done}/${p.chunk.total})` : '';
      audioLabel.textContent = `Audiobook: chapter ${p.done + 1}/${p.total}${part}…`;
    });
    try {
      const res = await api.generateAudiobook(id, voice);
      setSpin(false);
      if (res && res.canceled) { audioLabel.textContent = '🎧 Cancelled'; return; }
      audioLabel.textContent = `📖 Audiobook saved (${res.chapters} chapters)`;
      toast('✅ Whole audiobook saved.', 'ok');
      await api.openPath(res.path);
    } catch (err) {
      setSpin(false);
      toast(`Audiobook failed: ${err.message}`, 'bad');
    } finally { off && off(); audioBusy = false; }
  }

  const bar = h('div', { class: 'reader-bar' },
    h('button', { class: 'icon-btn', title: 'Library', onClick: () => go('library') }, '←'),
    h('button', { class: 'icon-btn', title: 'Contents', onClick: toggleToc }, '☰'),
    h('div', { class: 'title' }, content.title),
    h('div', { class: 'spacer' }),
    // typography controls
    h('div', { class: 'reader-tools' },
      h('button', { class: 'icon-btn', title: 'Smaller text', onClick: () => bumpFont(-1) }, 'A−'),
      h('button', { class: 'icon-btn', title: 'Larger text', onClick: () => bumpFont(1) }, 'A+'),
      familySelect(),
      themeSelect(),
      modeSelect()),
    h('div', { class: 'reader-actions' },
      paused ? h('button', { class: 'btn btn-gold btn-sm', onClick: () => startResume(id) }, '▶ Continue') : null,
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Listen to this chapter (ElevenLabs)', onClick: () => playChapterAudio() }, '🎧 Listen'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Save EPUB file', onClick: () => downloadEpub(id) }, '⤓ EPUB'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Email a PDF', onClick: () => emailPdfModal(id, content.title) }, '✉ PDF'),
      h('button', { class: 'btn btn-gold btn-sm', title: 'Send EPUB to Kindle', onClick: () => sendKindle(id) }, '📨 Kindle'),
      h('button', { class: 'icon-btn danger', title: 'Delete', onClick: () => deleteBook(id) }, '🗑')));

  const nav = h('div', { class: 'reader-nav' },
    h('button', { class: 'btn btn-ghost btn-sm', id: 'r-prev', onClick: () => step(-1) }, '‹ Prev'),
    pageInfo,
    h('button', { class: 'btn btn-ghost btn-sm', id: 'r-next', onClick: () => step(1) }, 'Next ›'));

  const main = h('main', { class: 'reader-main' },
    paused && content.pausedReason
      ? h('div', { class: 'pause-note' }, `⏸️ ${content.pausedReason.detail || 'Paused.'} `,
          h('button', { class: 'btn btn-gold btn-sm', onClick: () => startResume(id) }, '▶ Continue writing'))
      : null,
    contentEl, nav);

  root.append(bar, h('div', { class: 'reader-progress' }, progressFill), audioBar, h('div', { class: 'reader-body' }, tocDrawer, main));
  setVars();
  mount(root);

  // --- TOC ---
  function buildToc() {
    tocDrawer.innerHTML = '';
    tocDrawer.append(h('div', { class: 'toc-head' }, 'Contents'));
    pages.forEach((pg, i) => {
      const num = pg.kind === 'chapter' ? String(pg.number) : (pg.kind === 'cover' ? '✦' : '•');
      tocDrawer.append(h('button', {
        class: `toc-item ${i === cur ? 'active' : ''}`, 'data-i': i,
        onClick: () => { goPage(i); if (window.innerWidth < 760) tocDrawer.classList.remove('open'); },
      }, h('span', { class: 'toc-n' }, num), pg.label));
    });
  }

  // --- rendering ---
  function coverEl() {
    return h('div', { class: 'reader-cover full-page' }, h('img', { src: content.cover, alt: 'Cover' }));
  }
  function prefaceEl() {
    return h('section', { class: 'epub-chapter front-matter' },
      h('div', { class: 'titlepage' },
        h('div', { class: 'fm-title' }, content.title),
        content.subtitle ? h('div', { class: 'fm-subtitle' }, content.subtitle) : null,
        h('div', { class: 'fm-author' }, `by ${content.author || 'Anonymous'}`),
        content.premise ? h('div', { class: 'fm-preface' }, h('div', { class: 'fm-preface-label' }, 'Preface'), h('p', {}, content.premise)) : null));
  }
  function pageEl(pg, i) {
    if (pg.kind === 'cover') { const c = coverEl(); c.setAttribute('data-i', i); return c; }
    if (pg.kind === 'preface') { const p = prefaceEl(); p.setAttribute('data-i', i); return p; }
    const sec = h('section', { class: 'epub-chapter', 'data-i': i });
    sec.innerHTML = pg.html;
    return sec;
  }
  function renderBody() {
    contentEl.innerHTML = '';
    if (!pages.length) { contentEl.append(h('p', { style: 'text-align:center;color:#999' }, 'No content yet.')); return; }
    if (prefs.mode === 'scroll') {
      pages.forEach((pg, i) => contentEl.append(pageEl(pg, i)));
      nav.style.display = 'none';
    } else {
      contentEl.append(pageEl(pages[cur], cur));
      nav.style.display = 'flex';
    }
    updateProgress();
    buildToc();
    contentEl.scrollTop = 0;
    if (main) main.scrollTop = 0;
  }

  function updateProgress() {
    document.querySelectorAll('.toc-item').forEach((b) => b.classList.toggle('active', Number(b.getAttribute('data-i')) === cur));
    if (prefs.mode === 'chapter') {
      const pg = pages[cur];
      pageInfo.textContent = pg && pg.kind === 'chapter'
        ? `Chapter ${pg.chIndex + 1} of ${chapters.length}`
        : (pg ? pg.label : '');
      const pct = pages.length ? ((cur + 1) / pages.length) * 100 : 0;
      progressFill.style.width = pct + '%';
      const prev = document.getElementById('r-prev'); const next = document.getElementById('r-next');
      if (prev) prev.disabled = cur <= 0;
      if (next) next.disabled = cur >= pages.length - 1;
    }
  }

  function goPage(i) {
    const prev = cur;
    cur = Math.min(Math.max(i, 0), pages.length - 1);
    saveReaderPos(id, cur);
    if (cur !== prev) resetAudioForNewChapter(); // stop stale audio, prompt to Listen for the new chapter
    if (prefs.mode === 'scroll') {
      const sec = contentEl.querySelector(`[data-i="${cur}"]`);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateProgress();
    } else {
      renderBody();
    }
  }
  function step(d) { goPage(cur + d); }

  // --- controls ---
  function bumpFont(d) {
    prefs.fontSize = Math.min(28, Math.max(14, prefs.fontSize + d));
    saveReaderPrefs(prefs); setVars();
  }
  function familySelect() {
    const sel = h('select', { class: 'reader-select', title: 'Typeface' },
      h('option', { value: 'serif', selected: prefs.family === 'serif' ? 'selected' : false }, 'Serif'),
      h('option', { value: 'sans', selected: prefs.family === 'sans' ? 'selected' : false }, 'Sans'));
    sel.addEventListener('change', () => { prefs.family = sel.value; saveReaderPrefs(prefs); setVars(); });
    return sel;
  }
  function themeSelect() {
    const sel = h('select', { class: 'reader-select', title: 'Theme' },
      h('option', { value: 'light', selected: prefs.theme === 'light' ? 'selected' : false }, '☀ Light'),
      h('option', { value: 'sepia', selected: prefs.theme === 'sepia' ? 'selected' : false }, '🜂 Sepia'),
      h('option', { value: 'night', selected: prefs.theme === 'night' ? 'selected' : false }, '🌙 Night'));
    sel.addEventListener('change', () => { prefs.theme = sel.value; saveReaderPrefs(prefs); setVars(); });
    return sel;
  }
  function modeSelect() {
    const sel = h('select', { class: 'reader-select', title: 'Reading mode' },
      h('option', { value: 'chapter', selected: prefs.mode === 'chapter' ? 'selected' : false }, 'Page'),
      h('option', { value: 'scroll', selected: prefs.mode === 'scroll' ? 'selected' : false }, 'Scroll'));
    sel.addEventListener('change', () => { prefs.mode = sel.value; saveReaderPrefs(prefs); renderBody(); });
    return sel;
  }

  // scroll-mode progress + active chapter tracking
  main.addEventListener('scroll', () => {
    if (prefs.mode !== 'scroll') return;
    const max = main.scrollHeight - main.clientHeight;
    progressFill.style.width = (max > 0 ? (main.scrollTop / max) * 100 : 0) + '%';
    let active = cur;
    contentEl.querySelectorAll('[data-i]').forEach((sec) => {
      if (sec.getBoundingClientRect().top < 160) active = Number(sec.getAttribute('data-i'));
    });
    if (active !== cur) { cur = active; saveReaderPos(id, cur); updateProgress(); }
  });

  // keyboard navigation
  state.readerKeys = (e) => {
    if (state.view !== 'reader') return;
    if (e.key === 'ArrowRight' && prefs.mode === 'chapter') step(1);
    else if (e.key === 'ArrowLeft' && prefs.mode === 'chapter') step(-1);
    else if (e.key === 'Escape') go('library');
  };
  document.addEventListener('keydown', state.readerKeys);

  renderBody();
}

async function downloadEpub(id) {
  toast('Exporting EPUB…');
  try {
    const res = await api.exportBook(id, 'epub', true);
    if (res.canceled) return;
    toast('Saved EPUB. Opening…', 'ok');
    await api.openPath(res.path);
  } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
}
async function sendKindle(id) {
  const k = state.settings && state.settings.kindle;
  if (!k || !k.toAddress) {
    toast('Add your @kindle.com address in Settings first.', 'bad');
    return go('settings');
  }
  const usingSmtp = k.method === 'smtp' && k.smtp && k.smtp.host;
  toast(usingSmtp ? 'Building EPUB and emailing it to Kindle…' : 'Building EPUB and opening Mail…');
  try {
    const res = await api.sendToKindle(id);
    if (res && res.method === 'mail') toast('📨 Mail is ready with the book attached — just press Send.', 'ok');
    else if (res && res.method === 'mail-noattach') toast('Opened Mail, but couldn’t auto-attach — I revealed the file in Finder; drag it into the email, then Send.', 'bad');
    else if (res && res.method === 'saved') toast('Saved the file — attach it to an email to your Kindle.', 'ok');
    else toast('📨 Sent! It will appear on your Kindle shortly.', 'ok');
  } catch (err) { toast(`Send failed: ${err.message}`, 'bad'); }
}
function emailPdfModal(id, title) {
  const k = (state.settings && state.settings.kindle) || {};
  const usingSmtp = k.method === 'smtp' && k.smtp && k.smtp.host && k.fromAddress;
  const subline = usingSmtp
    ? `“${title}” will be rendered to PDF and sent from ${k.fromAddress} via your SMTP account.`
    : `“${title}” will be rendered to PDF, then opened in your Mail app with the file attached — just press Send.`;
  const input = h('input', { type: 'email', placeholder: 'name@example.com',
    value: state.settings.pdfEmailTo || '', onkeydown: (e) => { if (e.key === 'Enter') doSend(); } });
  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'modal', style: 'max-width:460px' },
      h('h2', { style: 'margin:0 0 6px' }, 'Email this book as a PDF'),
      h('p', { class: 'hint', style: 'margin-bottom:12px' }, subline),
      h('label', { class: 'field' }, h('span', {}, 'Recipient email'), input),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-sm', onClick: doSend }, '✉ Send PDF'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => overlay.remove() }, 'Cancel'))));
  document.body.append(overlay);
  setTimeout(() => input.focus(), 30);
  async function doSend() {
    const to = input.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Enter a valid email address.', 'bad'); return; }
    overlay.remove();
    toast(usingSmtp ? 'Rendering PDF and emailing…' : 'Rendering PDF and opening Mail…');
    try {
      const res = await api.emailPdf(id, to);
      state.settings = await api.getSettings();
      if (res && res.method === 'mail') toast(`✉ Mail is ready for ${to} with the PDF attached — press Send.`, 'ok');
      else if (res && res.method === 'mail-noattach') toast('Opened Mail, but couldn’t auto-attach — I revealed the PDF; drag it in, then Send.', 'bad');
      else if (res && res.method === 'saved') toast('PDF saved — attach it from the folder that opened.', 'ok');
      else toast(`✉ PDF emailed to ${to}.`, 'ok');
    } catch (err) { toast(`Email failed: ${err.message}`, 'bad'); }
  }
}
async function deleteBook(id) {
  if (!window.confirm('Delete this book permanently?')) return;
  await api.deleteBook(id);
  toast('Book deleted.');
  go('library');
}

// ---------- SETTINGS ----------
function renderSettings() {
  const s = state.settings;
  const p = state.prereq || {};
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'Settings'),
    h('p', {}, 'Choose your AI engine & model, grounding options, and Kindle delivery.'));

  const npmOk = !!(p.npm && p.npm.found);
  const statusRow = (key, label) => {
    const info = p[key];
    const ok = info && info.found;
    const a = authOf(key);
    const dot = !ok ? 'bad' : (a ? (a.signedIn ? 'ok' : 'warn') : 'warn');
    const authChip = !ok ? null : h('span', {
      style: `font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;${a ? (a.signedIn ? 'color:var(--ok);background:rgba(31,170,107,.14)' : 'color:var(--accent-2);background:rgba(192,138,46,.16)') : 'color:var(--text-dim)'}`,
    }, a ? (a.signedIn ? '✓ Signed in' : 'Not signed in') : 'Checking…');
    const actions = [
      h('span', { style: 'color:var(--text-dim);font-size:12px' }, ok ? (info.version || 'found') : 'not installed'),
      authChip,
    ];
    if (!ok) actions.push(h('button', {
      class: 'btn btn-gold btn-sm',
      title: npmOk ? `Install ${label} via npm` : 'Requires npm (install Node.js first)',
      onClick: () => openInstallModal(key),
    }, '⬇ Install'));
    if (!(a && a.signedIn)) actions.push(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal(key) }, '🔑 Sign in'));
    return h('div', { class: 'kv' },
      h('span', { class: 'k' }, h('span', { class: `status-dot ${dot}` }), label),
      h('span', { style: 'display:flex;align-items:center;gap:10px' }, ...actions.filter(Boolean)));
  };

  const engineCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'AI engines, models & fallback chain'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' }, 'ChapterOne drives your locally installed CLI on your own subscription. With “Use subscription” on, API-key environment variables are stripped so billing always uses your plan login — never an API key. Research uses each CLI’s built-in web tools (Claude WebSearch/WebFetch, Codex --search, Gemini Google Search). Nothing is sent to any third-party server.'),
    engineBar(),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('label', { class: 'field' }, h('span', {}, 'Claude command'),
        h('input', { id: 's-claude-cmd', value: s.claudeCommand || 'claude' })),
      h('label', { class: 'field' }, h('span', {}, 'Codex command'),
        h('input', { id: 's-codex-cmd', value: s.codexCommand || 'codex' })),
      h('label', { class: 'field' }, h('span', {}, 'Gemini command'),
        h('input', { id: 's-gemini-cmd', value: s.geminiCommand || 'gemini' }))),
    statusRow('claude', 'Claude Code CLI'),
    statusRow('codex', 'Codex CLI'),
    statusRow('gemini', 'Gemini CLI'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost btn-sm', onClick: saveEngineCmds }, 'Save commands'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheck() }, 'Re-check CLIs'),
      h('button', { class: 'btn btn-ghost btn-sm', id: 'btn-auth', onClick: testAuth }, 'Test connection')));

  const k = s.kindle || {};
  const sm = k.smtp || {};
  const method = k.method || 'mail';
  const setMethod = (m) => updateSettings({ kindle: { method: m } }).then(() => renderSettings());

  const methodSeg = h('div', { class: 'seg' },
    h('button', { class: method === 'mail' ? 'active' : '', onClick: () => setMethod('mail') }, '✉️ Mail app — no setup'),
    h('button', { class: method === 'smtp' ? 'active' : '', onClick: () => setMethod('smtp') }, '⚡ SMTP — one-click auto-send'));

  const smtpRows = method === 'smtp' ? [
    h('label', { class: 'field' }, h('span', {}, 'Approved sender (from)'),
      h('input', { id: 's-k-from', value: k.fromAddress || '', placeholder: 'you@gmail.com' })),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'SMTP host'),
        h('input', { id: 's-smtp-host', value: sm.host || '', placeholder: 'smtp.gmail.com' })),
      h('label', { class: 'field' }, h('span', {}, 'Port'),
        h('input', { id: 's-smtp-port', value: sm.port || 587, type: 'number' }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'SMTP username'),
        h('input', { id: 's-smtp-user', value: sm.user || '', placeholder: 'you@gmail.com' })),
      h('label', { class: 'field' }, h('span', {}, 'SMTP password / app password'),
        h('input', { id: 's-smtp-pass', value: sm.pass || '', type: 'password' }))),
  ] : [
    h('p', { class: 'hint', style: 'margin:2px 0 4px' },
      'No setup needed. When you send, ChapterOne exports the file and opens your Mac’s Mail app with it attached — you just press Send. Switch to SMTP above if you want fully automatic one-click sending.'),
  ];

  const kindleCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'Delivery & Send to Kindle'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'For Kindle, add your “@kindle.com” address from Amazon → Manage Your Content & Devices → Preferences → Personal Document Settings. With SMTP, also add your sender email to Amazon’s Approved list.'),
    h('label', { class: 'field' }, h('span', {}, 'How should books be sent?'), methodSeg),
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('label', { class: 'field' }, h('span', {}, 'Your Kindle address'),
        h('input', { id: 's-k-to', value: k.toAddress || '', placeholder: 'yourname@kindle.com' })),
      h('label', { class: 'field' }, h('span', {}, 'Default delivery format'),
        selectEl('s-k-format', ['epub', 'pdf'], k.preferredFormat || 'epub'))),
    ...smtpRows,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary btn-sm', onClick: saveKindle }, 'Save'),
      method === 'smtp' ? h('button', { class: 'btn btn-ghost btn-sm', onClick: verifyKindle }, 'Verify SMTP') : null));

  const imgs = s.images || {};
  const imageModels = state.models.imageModels || [];
  const imgModelSel = h('select', { id: 's-img-model' });
  (imageModels.length ? imageModels : [{ id: 'gemini-3-pro-image', label: 'Nano Banana Pro' }])
    .forEach((m) => imgModelSel.append(h('option', { value: m.id, selected: m.id === (imgs.model || 'gemini-3-pro-image') ? 'selected' : false }, m.label + (m.price ? ` (~$${m.price}/img)` : ''))));
  const imageCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'AI Illustrations · Nano Banana'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Optional. Nano Banana (Google’s Gemini image model) creates real, theme-matched illustrations for any book — it isn’t available on any CLI, so it uses a Gemini API key. This key is for images only, stored locally on this Mac, and never touches your CLI/text subscription. Get a key at aistudio.google.com/apikey, then pick “🍌 Nano Banana” as the image option when writing.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Gemini API key (image-only)'),
        h('input', { id: 's-img-key', type: 'password', value: imgs.geminiApiKey || '', placeholder: 'AIza…' })),
      h('label', { class: 'field' }, h('span', {}, 'Image model'), imgModelSel)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary btn-sm', onClick: saveImages }, 'Save'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: verifyImages }, 'Test key')));

  const aud = s.audio || {};
  const audModels = state.models.audioModels || [{ id: 'eleven_multilingual_v2', label: 'Multilingual v2' }];
  const audModelSel = h('select', { id: 's-aud-model' });
  audModels.forEach((m) => audModelSel.append(h('option', { value: m.id, selected: m.id === (aud.model || 'eleven_multilingual_v2') ? 'selected' : false }, m.label)));
  const voiceBox = h('div', { id: 'voice-pickers', class: 'voice-pickers' },
    h('span', { class: 'hint' }, aud.elevenApiKey ? 'Click “Load voices” to choose your narrators.' : 'Add your ElevenLabs key, Save, then load voices.'));
  const audioCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'Audiobook · ElevenLabs'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Optional. Listen to any book narrated by a top-tier AI voice. Uses your ElevenLabs API key — audio only, stored locally on this Mac, separate from your CLI/text subscription and the image key. Get a key at elevenlabs.io. ElevenLabs bills per character; ChapterOne narrates a chapter only when you press 🎧 Listen, and caches it.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'ElevenLabs API key (audio-only)'),
        h('input', { id: 's-aud-key', type: 'password', value: aud.elevenApiKey || '', placeholder: 'sk_…' })),
      h('label', { class: 'field' }, h('span', {}, 'Voice model'), audModelSel)),
    voiceBox,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary btn-sm', onClick: saveAudio }, 'Save'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: loadVoices }, '🔊 Load voices'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: verifyAudio }, 'Test key')),
    h('div', { style: 'border-top:1px solid var(--hairline);margin:16px 0 0;padding-top:14px' }, cloneVoiceUI()));

  mount(h('div', { class: 'view' }, head, engineCard, imageCard, audioCard, kindleCard));
}

async function saveImages() {
  await updateSettings({ images: { geminiApiKey: $('#s-img-key').value.trim(), model: $('#s-img-model').value } });
  toast('Image settings saved.', 'ok');
}
async function verifyImages() {
  await saveImages();
  if (!hasImageKey()) { toast('Enter a Gemini API key first.', 'bad'); return; }
  toast('Testing Nano Banana key…');
  try { await api.verifyImageKey(); toast('✅ Nano Banana key works.', 'ok'); }
  catch (err) { toast(`Key test failed: ${err.message}`, 'bad'); }
}

// ---- audiobook settings ----
function voiceSelectEl(id, voices, selected, recFlag) {
  const sel = h('select', { id });
  sel.append(h('option', { value: '', selected: !selected ? 'selected' : false }, '— none —'));
  const rec = voices.filter((v) => v[recFlag]);
  const rest = voices.filter((v) => !v[recFlag]);
  const opt = (v, star) => h('option', { value: v.voice_id, selected: v.voice_id === selected ? 'selected' : false }, `${star ? '★ ' : ''}${v.name}${v.category ? ` · ${v.category}` : ''}`);
  if (rec.length) { const og = h('optgroup', { label: '★ Recommended' }); rec.forEach((v) => og.append(opt(v, true))); sel.append(og); }
  if (rest.length) { const og = h('optgroup', { label: 'All voices' }); rest.forEach((v) => og.append(opt(v, false))); sel.append(og); }
  return sel;
}
function renderVoicePickers(box, voices) {
  const a = state.settings.audio || {};
  box.innerHTML = '';
  box.append(
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Narrator voice (adult books)'), voiceSelectEl('s-aud-voice', voices, a.voiceId, 'recAdult')),
      h('label', { class: 'field' }, h('span', {}, 'Kids narrator voice'), voiceSelectEl('s-aud-voice-kids', voices, a.voiceIdKids, 'recKids'))),
    h('span', { class: 'hint' }, '★ marks voices our research recommends for audiobooks / for kids. Choose, then click Save.'));
}
async function saveAudio() {
  const a = state.settings.audio || {};
  await updateSettings({ audio: {
    elevenApiKey: $('#s-aud-key').value.trim(),
    model: $('#s-aud-model').value,
    voiceId: $('#s-aud-voice') ? $('#s-aud-voice').value : (a.voiceId || ''),
    voiceIdKids: $('#s-aud-voice-kids') ? $('#s-aud-voice-kids').value : (a.voiceIdKids || ''),
  } });
  toast('Audio settings saved.', 'ok');
}
async function loadVoices() {
  await updateSettings({ audio: { elevenApiKey: $('#s-aud-key').value.trim(), model: $('#s-aud-model').value } });
  if (!(state.settings.audio && state.settings.audio.elevenApiKey)) { toast('Enter your ElevenLabs key first.', 'bad'); return; }
  const box = $('#voice-pickers');
  box.innerHTML = ''; box.append(h('span', { class: 'hint' }, 'Loading voices…'));
  try {
    const voices = await api.listVoices();
    if (!voices.length) { box.innerHTML = ''; box.append(h('span', { class: 'hint' }, 'No voices on this account yet — add some at elevenlabs.io.')); return; }
    renderVoicePickers(box, voices);
  } catch (err) { box.innerHTML = ''; box.append(h('span', { class: 'hint' }, `Could not load voices: ${err.message}`)); }
}
async function verifyAudio() {
  await saveAudio();
  if (!(state.settings.audio && state.settings.audio.elevenApiKey)) { toast('Enter your ElevenLabs key first.', 'bad'); return; }
  toast('Testing ElevenLabs key…');
  try { const r = await api.verifyAudio(); toast(`✅ Connected — ${r.count} voices available.`, 'ok'); }
  catch (err) { toast(`Key test failed: ${err.message}`, 'bad'); }
}
function blobToSample(blob, filename) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ dataUri: r.result, filename });
    r.onerror = () => reject(new Error('Could not read the audio sample.'));
    r.readAsDataURL(blob);
  });
}
/** "Clone your own voice": record via mic or upload a file, then send to ElevenLabs. */
const CLONE_SCRIPT =
  'The quick brown fox jumps over the lazy dog beside the river. ' +
  'As the warm afternoon light spilled across the valley, she paused to consider how far she had come, and how much further the road ahead might wind. ' +
  'Numbers and names, questions and quiet answers, all blended into one steady rhythm. ' +
  'Read these sentences naturally, the way you would tell a story to a good friend, and let your voice rise and fall with the meaning of the words. ' +
  'Take your time, breathe, and speak clearly. When you reach the end, you can stop recording.';

function cloneVoiceUI() {
  let recorder = null, recChunks = [], recordedBlob = null, uploadedFiles = [], stream = null;
  const status = h('span', { class: 'hint' }, 'Pick your microphone, press Record, and read the passage below (~30s). Needs an ElevenLabs paid plan.');
  const scriptBox = h('div', { class: 'clone-script' }, CLONE_SCRIPT);
  const preview = h('audio', { controls: 'controls', style: 'display:none;width:100%;height:34px;margin-top:8px' });
  const nameInput = h('input', { id: 'clone-name', placeholder: 'Voice name (e.g. “My Voice”)' });
  const micSel = deviceSelect('audioinput', audioPrefs.mic, (v) => { audioPrefs.mic = v; }, '🎙️ Default microphone');
  micSel.title = 'Input microphone';
  const recBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '⏺ Record');
  const stopBtn = h('button', { class: 'btn btn-danger btn-sm', type: 'button', style: 'display:none' }, '⏹ Stop');
  const delBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'display:none' }, '🗑 Delete');
  const fileInput = h('input', { type: 'file', accept: 'audio/*', multiple: 'multiple', style: 'padding:7px' });
  const createBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, '✨ Create my voice');

  const resetRecording = () => {
    recordedBlob = null; recChunks = [];
    if (preview._url) { URL.revokeObjectURL(preview._url); preview._url = null; }
    preview.removeAttribute('src'); preview.style.display = 'none';
    delBtn.style.display = 'none';
    status.textContent = 'Recording deleted. Record again, or upload a file.';
  };

  recBtn.addEventListener('click', async () => {
    try {
      stream = await getMicStream(audioPrefs.mic); // reused across re-records → only one mic prompt
      // Refresh device labels now that permission is granted.
      listDevices('audioinput').then((devs) => {
        if (!devs.length || !devs[0].label) return;
        micSel.innerHTML = '';
        micSel.append(h('option', { value: '' }, '🎙️ Default microphone'));
        devs.forEach((d, i) => micSel.append(h('option', { value: d.deviceId, selected: d.deviceId === audioPrefs.mic ? 'selected' : false }, d.label || `Microphone ${i + 1}`)));
      });
      recChunks = []; recordedBlob = null;
      recorder = new MediaRecorder(stream);
      recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) recChunks.push(e.data); });
      recorder.addEventListener('stop', async () => {
        recordedBlob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
        if (preview._url) URL.revokeObjectURL(preview._url);
        preview._url = URL.createObjectURL(recordedBlob);
        preview.src = preview._url; preview.style.display = 'block';
        await applySink(preview);
        // Keep the stream alive for re-records; it's released when leaving Settings.
        delBtn.style.display = '';
        status.textContent = 'Recording captured — play it back to check, delete if you want to redo, then Create.';
      });
      recorder.start();
      recBtn.style.display = 'none'; stopBtn.style.display = ''; delBtn.style.display = 'none';
      scriptBox.classList.add('recording');
      status.textContent = '● Recording… read the passage below aloud, naturally.';
    } catch (err) { status.textContent = `Microphone unavailable: ${err.message}. You can upload an audio file instead.`; }
  });
  stopBtn.addEventListener('click', () => { try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {} recBtn.style.display = ''; stopBtn.style.display = 'none'; scriptBox.classList.remove('recording'); });
  delBtn.addEventListener('click', resetRecording);
  fileInput.addEventListener('change', () => { uploadedFiles = Array.from(fileInput.files || []); if (uploadedFiles.length) status.textContent = `${uploadedFiles.length} file(s) selected.`; });

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Name your voice first.', 'bad'); return; }
    if (!(state.settings.audio && state.settings.audio.elevenApiKey)) { await saveAudio(); }
    const samples = [];
    try {
      if (recordedBlob) samples.push(await blobToSample(recordedBlob, 'recording.webm'));
      for (const f of uploadedFiles) samples.push(await blobToSample(f, f.name));
    } catch (err) { toast(err.message, 'bad'); return; }
    if (!samples.length) { toast('Record or upload a sample first.', 'bad'); return; }
    createBtn.setAttribute('disabled', 'true'); createBtn.textContent = 'Cloning…';
    status.textContent = 'Uploading to ElevenLabs and cloning your voice… (~20s)';
    try {
      const voice = await api.cloneVoice(name, samples);
      state.settings = await api.getSettings();
      toast(`✅ Cloned “${voice.name}” and set it as your narrator.`, 'ok');
      renderSettings();
    } catch (err) {
      toast(`Cloning failed: ${err.message}`, 'bad');
      status.textContent = err.message;
      createBtn.removeAttribute('disabled'); createBtn.textContent = '✨ Create my voice';
    }
  });

  return h('div', { class: 'clone-box' },
    h('span', { class: 'mini-label' }, '🎙️ Clone your own voice'),
    status,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('label', { class: 'field' }, h('span', {}, 'Voice name'), nameInput),
      h('label', { class: 'field' }, h('span', {}, 'Microphone'), micSel)),
    h('span', { class: 'mini-label' }, 'Read this aloud while recording:'),
    scriptBox,
    h('div', { class: 'btn-row' }, recBtn, stopBtn, delBtn, h('span', { style: 'align-self:center;color:var(--text-dim);font-size:12px' }, 'or upload:'), fileInput),
    preview,
    h('div', { class: 'btn-row' }, createBtn));
}

async function saveEngineCmds() {
  await updateSettings({
    claudeCommand: $('#s-claude-cmd').value.trim() || 'claude',
    codexCommand: $('#s-codex-cmd').value.trim() || 'codex',
    geminiCommand: $('#s-gemini-cmd').value.trim() || 'gemini',
  });
  await recheck();
  toast('Commands saved.', 'ok');
}
async function testAuth() {
  const btn = $('#btn-auth');
  btn.textContent = 'Testing…'; btn.setAttribute('disabled', 'true');
  try {
    const res = await api.checkAuth();
    toast(res.ok ? '✅ Connected on your subscription.' : `Not authenticated: ${res.detail}`, res.ok ? 'ok' : 'bad');
  } catch (err) { toast(`Test failed: ${err.message}`, 'bad'); }
  finally { btn.textContent = 'Test connection'; btn.removeAttribute('disabled'); }
}
async function saveKindle() {
  // The delivery method is persisted the moment it's toggled; here we save the
  // text fields, reading SMTP inputs only when they're rendered (SMTP mode).
  const kindle = {
    toAddress: $('#s-k-to').value.trim(),
    preferredFormat: $('#s-k-format').value,
  };
  if ($('#s-k-from')) kindle.fromAddress = $('#s-k-from').value.trim();
  if ($('#s-smtp-host')) {
    kindle.smtp = {
      host: $('#s-smtp-host').value.trim(),
      port: Number($('#s-smtp-port').value) || 587,
      secure: Number($('#s-smtp-port').value) === 465,
      user: $('#s-smtp-user').value.trim(),
      pass: $('#s-smtp-pass').value,
    };
  }
  await updateSettings({ kindle });
  toast('Settings saved.', 'ok');
}
async function verifyKindle() {
  await saveKindle();
  try { await api.verifyKindle(); toast('✅ SMTP connection works.', 'ok'); }
  catch (err) { toast(`SMTP check failed: ${err.message}`, 'bad'); }
}

// ---------- bootstrap ----------
// Route any in-app http(s) link through the OS browser instead of navigating
// the app window away.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="http"]');
  if (a) { e.preventDefault(); window.open(a.href, '_blank'); }
});
document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.view)));
if (api.onMenu) {
  api.onMenu((action) => { if (action === 'new-book') go('create'); if (action === 'settings') go('settings'); });
}

(async function init() {
  try { state.settings = await api.getSettings(); } catch (_) { state.settings = { provider: 'claude' }; }
  try { state.models = await api.getModels(); } catch (_) { /* defaults */ }
  await refreshPrereq();
  go('library');
  refreshAuthStatus(); // background: determine which CLIs are signed in
})();
})();
