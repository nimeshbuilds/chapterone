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
  if ((tag === 'button' || tag === 'select') && attrs.title && !attrs['aria-label']) e.setAttribute('aria-label', attrs.title);
  return e;
}
function mount(node) {
  const r = $('#view-root'); r.replaceChildren(node);
}
function pageHeading(eyebrow, title, description) {
  return h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, eyebrow),
    h('h1', {}, title), h('p', {}, description));
}
function writingSteps(active = 0) {
  return h('ol', { class: 'writing-steps', 'aria-label': 'Your writing journey' },
    ['Your idea', 'Chapter plan', 'Write & revise', 'Read & share'].map((label, index) =>
      h('li', { class: index === active ? 'current' : '', 'aria-current': index === active ? 'step' : null },
        h('span', { 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')), label)));
}
let dialogId = 0;
function presentModal(overlay, dismiss = () => closeModal(overlay)) {
  const heading = overlay.querySelector('h2');
  if (heading) {
    heading.id = `dialog-title-${++dialogId}`;
    overlay.setAttribute('aria-labelledby', heading.id);
  }
  overlay.setAttribute('aria-modal', 'true');
  overlay.addEventListener('cancel', (event) => { event.preventDefault(); dismiss(); });
  // Handle Escape before Chromium's CloseWatcher can close an editor while
  // its asynchronous unsaved-change confirmation is still awaiting a choice.
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  });
  // Native modal dialogs keep the rest of the app inert and restore focus to
  // their opener. Escape uses each dialog's own cleanup/cancellation path.
  document.body.append(overlay);
  overlay.showModal();
}
function closeModal(overlay) {
  const notice = overlay.querySelector('#toast');
  if (notice) document.body.append(notice);
  overlay.close(); overlay.remove();
}
let toastTimer = null;
function toast(msg, type = '') {
  const t = $('#toast');
  (document.querySelector('dialog[open]') || document.body).append(t);
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
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
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
// Browsers hide device labels — and collapse the whole list to one anonymous
// device per kind — until the page has microphone permission. This unlocks the
// full named list by obtaining the mic. With `prompt:false` it only unlocks when
// already granted (silent); with `prompt:true` it asks once (the OS caches it).
let _deviceLabelsUnlocked = false;
async function ensureDeviceLabels({ prompt = false } = {}) {
  if (_deviceLabelsUnlocked) return true;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    if (devs.some((d) => d.label)) { _deviceLabelsUnlocked = true; return true; } // already exposed
    if (!prompt) return false; // silent path: never prompt just to read names on render
    // The user explicitly opened a picker → capture the mic once. This routes
    // through the main process, which shows the OS prompt when undecided, returns
    // instantly if already granted, and rejects only if the user denied at the OS
    // level. We deliberately do NOT consult navigator.permissions.query here — in
    // Electron it reports "denied" for the not-yet-granted state and would wrongly
    // skip the prompt.
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop()); // labels stay exposed for the session afterward
    _deviceLabelsUnlocked = true;
    return true;
  } catch (_) { return false; }
}
/** A device <select> for speakers or mics. Populated once labels are available and
 *  refreshed only when devices actually change — never during the open gesture, which
 *  would wipe the native menu mid-open. The first time it's opened while names are
 *  still masked, it requests mic access (one prompt) so the full named list appears.
 *  Call sel._refresh() to repopulate on demand. */
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
  // Unmask silently if the mic is already granted, then populate.
  ensureDeviceLabels().finally(fill);
  // Re-list only when hardware is added/removed — safe, never during a click.
  // Auto-unhook once this select leaves the DOM: every re-render builds a new
  // select, and permanent listeners piled up forever.
  const onDevChange = () => { if (sel.isConnected) fill(); else { try { navigator.mediaDevices.removeEventListener('devicechange', onDevChange); } catch (_) { /* ignore */ } } };
  try { navigator.mediaDevices.addEventListener('devicechange', onDevChange); } catch (_) { /* ignore */ }
  // First open while masked → ask for the mic so real device names load. Retries
  // on each click (a dismissed prompt shouldn't permanently block the picker).
  let askInFlight = false;
  sel.addEventListener('mousedown', (e) => {
    if (_deviceLabelsUnlocked) return;  // full named list already available — open normally
    e.preventDefault();                 // don't open an empty/anonymous menu
    if (askInFlight) return;
    askInFlight = true;
    sel.blur();
    ensureDeviceLabels({ prompt: true }).then(async (ok) => {
      askInFlight = false;
      await fill();
      if (ok) { try { sel.showPicker(); } catch (_) { toast('🎧 Audio devices ready — open the menu again to choose.', 'ok'); } return; }
      toast('Microphone access is needed to list your audio devices. If you blocked it, turn on ChapterOne under System Settings → Privacy & Security → Microphone, then reopen this menu.', '');
    });
  });
  sel.addEventListener('change', () => onChange(sel.value));
  sel._refresh = fill;
  return sel;
}

// ---------- navigation ----------
async function go(view, arg) {
  if (document.querySelector('dialog[open]')) return;
  state.navigationId = (state.navigationId || 0) + 1;
  if (state.view === 'create' && $('#f-request')) state.draftSpec = readSpec();
  if (state.view === 'kids' && $('#k-request')) state.kidsDraft = readKidsSpec();
  document.body.classList.toggle('reader-open', view === 'reader');
  $('.content').scrollTop = 0;
  if (state.readerMenuCleanup) { state.readerMenuCleanup(); state.readerMenuCleanup = null; }
  if (view !== 'reader' && state.readerKeys) { document.removeEventListener('keydown', state.readerKeys); state.readerKeys = null; }
  if (view !== 'reader') state.readerLive = null; // stop refreshing the live-reading banner
  if (view !== 'reader' && state.readerAudioEl) {
    // Leaving the reader must stop narration — otherwise detached audio keeps
    // playing with no visible controls anywhere.
    try { state.readerAudioEl.pause(); } catch (_) { /* ignore */ }
    state.readerAudioEl = null;
  }
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

  const isGemini = provider === 'gemini';
  if (active && active.found) {
    if (!auth) {
      pill.className = 'pill'; // unknown yet — auth/connectivity probe running
      pill.textContent = `● ${name} · ${isGemini ? 'testing connection…' : 'checking sign-in…'}`;
      banner.classList.add('hidden');
    } else if (auth.signedIn) {
      pill.className = 'pill ok';
      pill.textContent = `● ${name} · ${isGemini ? 'API key connected' : 'signed in'}${chainNote}`;
      banner.classList.add('hidden');
    } else if (auth.signedIn == null) {
      pill.className = 'pill';
      pill.textContent = `● ${name} · status unavailable`;
      banner.replaceChildren(h('span', { class: 'grow' }, `${name} is installed. Sign-in status is unavailable; check the CLI in Terminal or use Settings.`),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: recheckAuth }, 'Re-check'));
      banner.classList.remove('hidden');
    } else if (isGemini) {
      // Gemini uses an API key, not a sign-in — frame it as connectivity.
      const keySet = hasImageKey();
      pill.className = 'pill bad';
      pill.textContent = `● Gemini · ${keySet ? 'API key not reachable' : 'needs API key'}`;
      banner.innerHTML = '';
      banner.append(
        h('span', { class: 'grow' }, keySet
          ? '⚠️ The Gemini API could not be reached. Check your API key and connection.'
          : '⚠️ ChapterOne needs a Gemini API key to use Gemini as a writing engine.'),
        h('button', { class: 'btn btn-gold btn-sm', onClick: () => openAuthModal('gemini') }, keySet ? '🔑 Update API key' : '🔑 Add Gemini API key'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheckAuth() }, 'Re-test'),
        h('button', { class: 'btn btn-ghost btn-sm', title: 'Hide until next check', onClick: () => banner.classList.add('hidden') }, '✕'));
      banner.classList.remove('hidden');
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
      ? `${name} isn’t set up. Choose an available engine or open Settings:`
      : 'Connect an AI engine to start writing. Choose a provider in Settings.';
    banner.append(h('span', { class: 'grow' }, msg));
    for (const id of others) {
      banner.append(h('button', { class: 'btn btn-gold btn-sm', onClick: () => switchProvider(id) }, `Use ${providerLabel(id)}`));
    }
    banner.append(
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('settings') }, 'Set up AI'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Hide until next check', onClick: () => banner.classList.add('hidden') }, '✕'));
    banner.classList.remove('hidden');
  }
}
async function recheck() {
  await refreshPrereq();
  await refreshAuthStatus();
}
/** Background probe of which installed CLIs are actually signed in. */
async function refreshAuthStatus() {
  try { state.authStatus = await api.getAuthStatus(); }
  catch (_) { state.authStatus = null; }
  await refreshPrereq();
  // Never re-render a view the user is actively typing in — the background
  // auth probe used to wipe half-filled Create/Settings forms.
  const a = document.activeElement;
  const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  if (typing) return;
  document.querySelectorAll('.provider-status').forEach(row => {
    row.replaceWith(providerStatusRow(row.dataset.provider, row.dataset.label));
  });
  // Update only the engine controls. A background result must not discard
  // unsaved settings or a brief just because the user moved focus elsewhere.
  renderEngineBarInPlace();
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
/** Human label for the chapter-illustration method a job is using. */
function imageMethodLabel(spec) {
  const mode = spec && spec.imageMode;
  if (mode === 'nano') return 'Nano Banana (AI photos)';
  if (mode === 'ai' || (spec && spec.illustrate) || mode === 'stock') return 'AI vector art (SVG)';
  return null; // text-only books use a typographic library cover
}
function modelField(provider) { return provider + 'Model'; }

function modelOptionsFor(provider) {
  const list = state.models[provider] || [];
  const field = modelField(provider);
  const current = state.settings[field] || '';
  const known = list.map((m) => m.id);
  const isCustom = !!current && !known.includes(current);

  const wrap = h('div', { class: 'model-pick' });
  const sel = h('select', { id: `eng-model-${provider}`, class: 'model-select', 'aria-label': `${providerLabel(provider)} model` });
  for (const m of list) sel.append(h('option', { value: m.id, selected: (!isCustom && m.id === current) ? 'selected' : false }, m.label));
  sel.append(h('option', { value: '__custom__', selected: isCustom ? 'selected' : false }, 'Custom model…'));

  // Checking Claude/Codex runs a real completion. Never probe just because a
  // saved pin is absent from this release's catalog or the user is typing.
  const input = h('input', { class: 'model-custom-input', 'aria-label': `Custom ${providerLabel(provider)} model ID`, placeholder: 'type the exact model id…', value: isCustom ? current : '' });
  const chip = h('span', { class: 'model-verify', 'aria-live': 'polite' }, 'Unchecked');
  const check = h('button', { class: 'btn btn-ghost btn-sm', disabled: !input.value.trim(), onClick: () => verify(input.value) }, 'Check model');
  const probeHint = h('span', { class: 'hint model-check-hint' },
    provider === 'claude' || provider === 'codex'
      ? 'Check model sends a short test prompt and uses your quota or API billing.'
      : 'Check model reads the provider’s model list without generating content.');
  const customRow = h('div', { class: 'model-custom', style: isCustom ? '' : 'display:none' }, input, check, chip, probeHint);
  const note = h('span', { class: 'hint model-note' });
  const showNote = (value) => {
    note.textContent = state.models.modelNotices?.[provider]?.[value] || list.find(m => m.id === value)?.note || '';
    note.hidden = !note.textContent;
  };
  showNote(current);
  const setChip = (cls, text) => { chip.className = 'model-verify ' + cls; chip.textContent = text; };

  let token = 0;
  const verify = async (val) => {
    const v = val.trim();
    if (!v) { setChip('', ''); return; }
    const mine = ++token;
    check.disabled = true;
    setChip('checking', '⏳ checking…');
    try {
      await updateSettings({ [field]: v });
      if (mine !== token) return;
      const r = await api.verifyModel(provider, v);
      if (mine !== token) return; // a newer keystroke superseded this check
      if (r.valid === true) setChip('ok', '✓ ' + (r.detail || 'valid model'));
      else if (r.valid === false) setChip('bad', '✗ ' + (r.detail || 'not a valid model'));
      else setChip('warn', '⚠ ' + (r.detail || 'could not verify'));
    } catch (e) { if (mine === token) setChip('warn', '⚠ ' + e.message); }
    finally { check.disabled = !input.value.trim(); }
  };

  input.addEventListener('input', () => {
    ++token;
    check.disabled = !input.value.trim();
    setChip('', 'Unchecked');
    showNote(input.value.trim());
  });
  input.addEventListener('change', async () => {
    if (sel.value !== '__custom__') return;
    try { await updateSettings({ [field]: input.value.trim() }); }
    catch (err) { toast(`Could not save model: ${err.message}`, 'bad'); }
  });

  sel.addEventListener('change', async () => {
    ++token;
    if (sel.value === '__custom__') {
      customRow.style.display = '';
      input.focus();
      showNote(input.value.trim());
    } else {
      customRow.style.display = 'none';
      await updateSettings({ [field]: sel.value });
      renderEngineBarInPlace();
    }
  });

  wrap.append(sel, customRow, note);
  return wrap;
}

function toggle(id, checked, label, onChange) {
  const input = h('input', { type: 'checkbox', id });
  if (checked) input.checked = true;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }, h('span', { class: 'thumb' })), h('span', { class: 'switch-label' }, label));
}

/** The ordered engine chain. chain[0] is the primary; the rest are fallbacks in
 *  order. The stored order is preserved exactly (so reordering sticks). */
function currentChain() {
  const s = state.settings;
  const ids = (state.models.providers || []).map((p) => p.id);
  let chain = (Array.isArray(s.chain) && s.chain.length) ? s.chain.slice() : [s.provider || 'claude'];
  chain = [...new Set(chain)].filter((id) => !ids.length || ids.includes(id));
  if (!chain.length) chain = [s.provider || ids[0] || 'claude'];
  return chain;
}

/** Persist a new chain order. chain[0] becomes the primary engine. */
async function setChain(ordered) {
  const chain = [...new Set((ordered || []).filter(Boolean))];
  if (!chain.length) return;
  await updateSettings({ chain, provider: chain[0] });
  await refreshPrereq();
  renderEngineBarInPlace();
}

/** Ordered chain rows (each with a per-provider model picker) + add buttons.
 *  chain[0] is the primary. Every row can move ↑/↓ and be removed ✕ — except
 *  when only one engine remains (then it has no reorder/remove buttons). */
function chainBuilder() {
  const chain = currentChain();
  const ids = (state.models.providers || []).map((p) => p.id);
  const only = chain.length === 1;
  const wrap = h('div', { class: 'chain-builder' });

  chain.forEach((pid, idx) => {
    const isPrimary = idx === 0;
    const swap = (a, i, j) => { const c = a.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; };
    const found = !!(state.prereq && state.prereq[pid] && state.prereq[pid].found);
    const meta = providerMeta(pid);
    const geminiTag = pid === 'gemini'
      ? h('span', { class: 'chain-tag ' + (hasImageKey() ? 'apikey' : 'warn') }, hasImageKey() ? 'API key' : 'needs API key')
      : (!found ? h('span', { class: 'chain-tag warn' }, 'not installed') : null);
    const row = h('div', { class: `chain-step ${isPrimary ? 'primary' : ''}` },
      h('span', { class: 'chain-order' }, String(idx + 1)),
      h('div', { class: 'chain-name' }, providerLabel(pid), isPrimary ? h('span', { class: 'chain-tag' }, 'primary') : null, geminiTag),
      modelOptionsFor(pid),
      // Offer install first when the CLI isn't on PATH (skip Gemini — it's API-key only).
      (!found && pid !== 'gemini' && meta.npmPackage) ? h('button', { class: 'icon-btn', title: `Install ${providerLabel(pid)}`, onClick: () => openInstallModal(pid) }, '⬇') : null,
      h('button', { class: 'icon-btn', title: pid === 'gemini' ? 'Gemini API key' : 'Sign in', onClick: () => openAuthModal(pid) }, '🔑'),
      idx > 0 ? h('button', { class: 'icon-btn', title: 'Move up', onClick: () => setChain(swap(chain, idx - 1, idx)) }, '↑') : null,
      idx < chain.length - 1 ? h('button', { class: 'icon-btn', title: 'Move down', onClick: () => setChain(swap(chain, idx, idx + 1)) }, '↓') : null,
      only ? null : h('button', { class: 'icon-btn danger', title: 'Remove from chain', onClick: () => setChain(chain.filter((x) => x !== pid)) }, '✕'));
    wrap.append(row);
  });

  // This Gemini integration uses an API key — make that explicit.
  if (chain.includes('gemini')) {
    const set = hasImageKey();
    wrap.append(set
      ? h('div', { class: 'chain-note', style: 'margin-top:10px' },
          '🔑 Gemini runs on your Gemini API key (per-token billing) — it does not use a subscription.')
      : h('div', { class: 'chain-note warn', style: 'margin-top:10px' },
          '⚠️ ChapterOne uses the Gemini API — add your API key to connect. ',
          h('button', { class: 'btn btn-gold btn-sm', style: 'margin-left:6px', onClick: () => openAuthModal('gemini') }, '🔑 Add Gemini API key')));
  }

  const addable = ids.filter((id) => !chain.includes(id));
  if (addable.length) {
    const add = h('div', { class: 'chain-add' }, h('span', { class: 'mini-label' }, 'Add engine:'));
    for (const id of addable) {
      add.append(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => setChain([...chain, id]) }, `+ ${providerLabel(id)}`));
    }
    wrap.append(add);
  }
  return wrap;
}

/** No images / AI vector art / Nano Banana segmented control. */
function hasImageKey() {
  return !!(state.settings.images && state.settings.images.geminiApiKey && state.settings.images.geminiApiKey.trim());
}
function imageModeControl() {
  let mode = state.settings.imageMode || 'off';
  if (mode === 'stock') { mode = 'ai'; updateSettings({ imageMode: 'ai' }); } // stock retired → vector art
  const seg = h('div', { class: 'seg' });
  const opts = [
    { v: 'ai', l: '🎨 AI vector art' },
    { v: 'nano', l: '🍌 Nano Banana (real AI photos)' },
    { v: 'off', l: 'No images' },
  ];
  for (const o of opts) {
    seg.append(h('button', { class: mode === o.v ? 'active' : '', onClick: () => updateSettings({ imageMode: o.v }).then(renderEngineBarInPlace) }, o.l));
  }
  const nanoNeedsKey = mode === 'nano' && !hasImageKey();
  const hint = mode === 'nano'
    ? (hasImageKey()
        ? 'Illustrations generated with your selected Nano Banana model. Image-output estimates are shown before writing; Google also bills for input and thinking tokens.'
        : 'Nano Banana needs your Gemini API key (image-only, separate from your CLI subscription).')
    : mode === 'ai'
      ? 'Your selected writing engine designs the cover and chapter illustrations. This uses your provider’s subscription quota or Gemini API billing. Review generated artwork before publishing.'
      : 'Text only. No AI cover or illustration requests; the library uses a simple typographic cover.';
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
    let title;
    if (p.id === 'gemini') {
      // This integration uses the Gemini API.
      title = hasImageKey() ? `${p.label}: using your Gemini API key` : `${p.label}: needs a Gemini API key (no subscription)`;
    } else {
      title = signedIn ? `${p.label}: signed in` : (found ? `${p.label}: installed, not signed in` : `${p.label}: not installed`);
    }
    const cls = [provider === p.id ? 'active' : '', signedIn ? 'found' : (found ? 'warn' : '')].filter(Boolean).join(' ');
    seg.append(h('button', { class: cls, title, onClick: () => switchProvider(p.id) }, h('span', { class: 'sdot' }), p.label));
  }
  const bar = h('div', { class: 'engine-bar card', id: 'engine-bar' },
    h('div', { class: 'engine-row' },
      h('div', { class: 'engine-col' },
        h('span', { class: 'mini-label' }, 'Primary engine'),
        seg)),
    h('div', { class: 'engine-row', style: 'margin-top:14px;flex-direction:column;align-items:stretch;gap:8px' },
      h('div', { class: 'preset-row' },
        h('span', { class: 'mini-label' }, 'Engines, models & automatic fallback chain'),
        h('div', { class: 'preset-btns' },
          h('span', { class: 'preset-label' }, 'Quick pick:'),
          h('button', { class: 'btn btn-ghost btn-sm', title: 'Fast choices; Grok uses your CLI default', onClick: () => applyPreset('fast') }, '⚡ Fast'),
          h('button', { class: 'btn btn-ghost btn-sm', title: 'Quality-focused models across your chain', onClick: () => applyPreset('pro') }, '💎 Pro'),
          h('button', { class: 'btn btn-ghost btn-sm', title: 'Your CLI configuration, or the Gemini Flash alias', onClick: () => applyPreset('default') }, 'Default'))),
      chainBuilder(),
      h('span', { class: 'hint catalog-reviewed' }, `Model catalog reviewed ${state.models.reviewedAt || 'with this release'}. Access depends on your account and installed CLI version. Custom IDs remain available for newer releases.`),
      h('span', { class: 'hint' }, 'Writing runs top-to-bottom. If an engine’s quota runs out mid-book, it continues automatically on the next. Use Quick pick to set Fast / Pro / Default models across every engine at once.')),
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
  const summary = $('.writing-options summary');
  if (summary) summary.textContent = writingOptionsLabel();
  const ready = state.prereq && state.prereq[state.settings.provider || 'claude']?.found;
  for (const [id, label] of [['btn-clarify', 'Continue →'], ['btn-skip', 'Skip questions & write now'], ['btn-kids-go', 'Write the kids book']]) {
    const button = document.getElementById(id);
    if (button) { button.disabled = !ready; button.textContent = ready ? label : 'Connect an AI engine to write'; }
  }
}
function writingOptionsLabel() { return `Writing options · ${providerLabel(state.settings.provider || 'claude')}`; }
function writingOptions() {
  return h('details', { class: 'writing-options card' }, h('summary', {}, writingOptionsLabel()), engineBar());
}
/** Set Fast / Pro / Default models on every engine in the current chain at once. */
async function applyPreset(preset) {
  const presets = state.models.presets || {};
  const patch = {};
  for (const id of currentChain()) {
    const p = presets[id] || {};
    patch[modelField(id)] = p[preset] != null ? p[preset] : (p.default || '');
  }
  await updateSettings(patch);
  renderEngineBarInPlace();
  toast(`${preset === 'fast' ? '⚡ Fast' : preset === 'pro' ? '💎 Pro' : 'Default'} models applied`, 'ok');
}
async function switchProvider(p) {
  // Make p the primary engine: move it to the front of the chain, keeping the
  // rest in order. Remove an engine entirely (e.g. Claude) with its ✕ button.
  const chain = currentChain();
  await setChain([p, ...chain.filter((id) => id !== p)]);
}

// ---------- guided sign-in modal ----------
function openAuthModal(provider) {
  const name = providerLabel(provider);

  // This Gemini integration uses the REST API. It runs on a
  // Gemini API key, so route the user to the key instead of opening a Terminal.
  if (provider === 'gemini') {
    const s = state.settings || {};
    const hasKey = !!((s.images && s.images.geminiApiKey) || s.geminiApiKey);
    const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
      h('div', { class: 'modal', style: 'max-width:480px' },
        h('h2', { style: 'margin:0 0 6px' }, 'Connect Gemini'),
        h('p', { class: 'hint', style: 'margin-bottom:10px' },
          'ChapterOne uses the Gemini API with your API key. Text and image generation are billed by Google separately from CLI subscriptions.'),
        h('p', { class: 'hint', style: 'margin-bottom:14px' },
          hasKey ? '✅ A Gemini API key is set, so Gemini is ready to use.'
                 : 'Get a key at aistudio.google.com/apikey, then paste it into the Gemini API key field in Settings.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-gold btn-sm', onClick: () => { closeModal(overlay); go('settings'); } }, hasKey ? 'Open Settings' : '🔑 Add key in Settings'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Close'))));
    presentModal(overlay);
    return;
  }

  // The CLI must exist before we can sign in — if it isn't on PATH, install first.
  const installed = !!(state.prereq && state.prereq[provider] && state.prereq[provider].found);
  if (!installed && providerMeta(provider).npmPackage) {
    return openInstallModal(provider);
  }

  const status = h('p', { class: 'hint' }, 'Opening Terminal…');
  const cmdLine = h('pre', { class: 'auth-log' }, '');
  let poll = null;
  let done = false;
  const close = () => { if (poll) clearInterval(poll); closeModal(overlay); };

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
      toast(res.ok == null ? `Sign-in status unavailable: ${res.detail || 'Check the CLI in Terminal.'}` : `Not signed in yet: ${res.detail || 'finish sign-in in Terminal first'}`, 'bad');
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
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 6px' }, `Sign in to ${name}`),
      status,
      h('p', { class: 'hint' }, 'A Terminal window opens running the sign-in command (a browser may open to authorize). Finish it there — ChapterOne detects success automatically. You can also click “I’ve finished” to check now.'),
      cmdLine,
      h('div', { class: 'btn-row' },
        recheckBtn,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => api.startAuth(provider).catch(() => {}) }, '↺ Reopen Terminal'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: close }, 'Close'))));
  presentModal(overlay, close);

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

  const close = () => { if (unsub) unsub(); closeModal(overlay); };
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 6px' }, `Install ${label}`),
      h('p', { class: 'hint' }, meta.npmPackage
        ? `This runs “npm install -g ${meta.npmPackage}”, then verifies it’s on your PATH. Afterwards you sign in with your own ${label} subscription. Check the active account and billing settings in that CLI.`
        : `No automatic installer is available for ${label}.`),
      log,
      h('div', { class: 'btn-row' }, startBtn,
        meta.docsUrl ? h('a', { href: meta.docsUrl, class: 'btn btn-ghost btn-sm' }, 'Install docs') : null,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: close }, 'Close'))));
  presentModal(overlay, close);

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
function libView() { return localStorage.getItem('bw.lib.view') === 'list' ? 'list' : 'tiles'; }
function setLibView(v) { localStorage.setItem('bw.lib.view', v); renderLibrary(); }

/** Mac-Finder-style date: "Today, 9:41 AM" / "Jun 22" (this year) / "Jun 22, 2025". */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${time}`;
  const opts = d.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

function statusLabelFor(b) {
  return b.status === 'complete' ? 'Finished draft' : b.status === 'generating' ? 'Writing…' : (b.status === 'paused' ? 'Paused' : (b.status || 'draft'));
}
/** Keep every library row's status explicit, including completed books. */
function statusBadge(b) {
  return h('span', { class: `badge ${b.status}` }, b.status === 'complete' ? 'Ready' : statusLabelFor(b));
}
/** Industry-standard audience/format badge (Picture Book · Ages 3–5, Adult · Fiction, …). */
function classBadge(c, text) {
  if (!c) return null;
  return h('span', { class: `class-badge ${c.kids ? 'kids' : 'adult'}`, title: `${c.label} · ${c.audience}` }, `${c.emoji} ${text || c.label}`);
}
function coverFor(b, cls) {
  return b.cover
    ? h('div', { class: `book-cover has-art ${cls || ''}` }, h('img', { src: b.cover, alt: '' }))
    : h('div', { class: `book-cover ${cls || ''}`, style: `background:${coverGradient(b.title)}` },
        h('h3', {}, b.title || 'Untitled'),
        h('div', { class: 'by' }, `by ${b.author || 'Anonymous'}`));
}

/** Start a sequel: prefill the Create form with the world/cast of a finished book. */
async function startSequel(id) {
  try {
    const b = await api.getBook(id);
    state.draftSpec = {
      request: `Write the SEQUEL to "${b.title}"${b.subtitle ? ` (${b.subtitle})` : ''}. Same world, same voice, same cast. Story so far: ${b.premise || b.logline || ''} Pick up after the ending and raise the stakes with a fresh central problem.`,
      kind: b.kind || '',
      genre: b.genre || '',
      audience: b.audience || '',
      tone: '',
      authorName: b.author || '',
      characters: (b.characters || []).map((c) => ({ name: c.name, role: c.role, photo: c.photo })),
      reviewOutline: true,
    };
    if (b.isKids && b.ageBand) {
      state.kidsDraft = { request: state.draftSpec.request, ageBand: b.ageBand, genre: b.genre || '', authorName: b.author || '', characters: state.draftSpec.characters };
      return go('kids');
    }
    go('create');
    toast('📚 Sequel brief prefilled — tweak anything, then continue.', 'ok');
  } catch (e) { toast(`Couldn't load the book: ${e.message}`, 'bad'); }
}

async function renderLibrary() {
  let books;
  try { books = await api.listBooks(); }
  catch (error) {
    mount(h('div', { class: 'view' }, pageHeading('YOUR WORKSPACE', 'Your Library', 'Your books are still on this device.'),
      h('div', { class: 'card' }, h('p', { role: 'alert' }, `Could not load your library: ${error.message}`),
        h('button', { class: 'btn btn-primary', onClick: renderLibrary }, 'Try again'))));
    return;
  }
  const recent = books[0];
  const sort = state.libSort || 'recent';
  if (sort === 'title') books.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  if (sort === 'words') books.sort((a, b) => (b.words || 0) - (a.words || 0));
  const view = libView();
  const head = pageHeading('YOUR WRITING SPACE', 'Your Library', 'Every good book begins with a little room to think.');
  const overview = books.length ? h('section', { class: 'library-overview', 'aria-label': 'Library overview' },
    h('div', { class: 'continue-card' }, h('p', { class: 'eyebrow' }, 'PICK UP WHERE YOU LEFT OFF'),
      h('h2', {}, recent.title || 'Untitled'),
      h('p', {}, `${(recent.words || 0).toLocaleString()} words · ${recent.chapters} chapter${recent.chapters === 1 ? '' : 's'} · ${statusLabelFor(recent)}`),
      h('button', { class: 'btn btn-primary btn-sm', onClick: () => go('reader', recent.id) }, 'Open manuscript →')),
    h('div', { class: 'library-totals' },
      h('div', {}, h('strong', {}, books.length), h('span', {}, books.length === 1 ? 'book in your library' : 'books in your library')),
      h('div', {}, h('strong', {}, books.reduce((n, b) => n + (b.words || 0), 0).toLocaleString()), h('span', {}, 'words on the page')))) : null;

  const viewToggle = h('div', { class: 'seg view-toggle' },
    h('button', { class: view === 'tiles' ? 'active' : '', 'aria-pressed': String(view === 'tiles'), title: 'Tiles', onClick: () => setLibView('tiles') }, '▦ Tiles'),
    h('button', { class: view === 'list' ? 'active' : '', 'aria-pressed': String(view === 'list'), title: 'List', onClick: () => setLibView('list') }, '☰ List'));

  // Search-as-you-type over title/author/genre — a library of sequels grows fast.
  const q = (state.libQuery || '').trim().toLowerCase();
  const searchBox = h('input', {
    class: 'lib-search', type: 'search', 'aria-label': 'Search books by title, author, or genre', placeholder: 'Search your library…', value: state.libQuery || '',
  });
  const resultCount = h('p', { class: 'library-count', role: 'status', 'aria-live': 'polite' });
  const statusFilter = h('select', { class: 'lib-status', 'aria-label': 'Filter by book status' },
    ...[['all', 'All books'], ['complete', 'Finished drafts'], ['paused', 'Paused'], ['generating', 'Writing'], ['draft', 'Planned']].map(([value, label]) =>
      h('option', { value, selected: value === (state.libStatus || 'all') }, label)));
  const sortSelect = h('select', { class: 'lib-sort', 'aria-label': 'Sort books', onChange: (e) => { state.libSort = e.target.value; renderLibrary(); } },
    ...[['recent', 'Recently updated'], ['title', 'Title A–Z'], ['words', 'Word count']].map(([value, label]) => h('option', { value, selected: value === sort }, label)));
  const noResults = h('div', { class: 'empty search-empty hidden' },
    h('h2', {}, 'No matching books'),
    h('p', {}, 'Try a different title or choose another status.'),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { searchBox.value = ''; statusFilter.value = 'all'; filterBooks(); searchBox.focus(); } }, 'Clear search'));
  function filterBooks() {
    state.libQuery = searchBox.value;
    state.libStatus = statusFilter.value;
    const term = searchBox.value.trim().toLowerCase();
    let count = 0;
    document.querySelectorAll('[data-book-search]').forEach((el) => {
      const matches = (el.dataset.bookSearch || '').includes(term) && (statusFilter.value === 'all' || el.dataset.bookStatus === statusFilter.value);
      el.style.display = matches ? '' : 'none';
      if (matches) count++;
    });
    noResults.classList.toggle('hidden', count > 0 || !books.length);
    resultCount.textContent = term || statusFilter.value !== 'all' ? `${count} of ${books.length} books` : `${books.length} book${books.length === 1 ? '' : 's'}`;
  }
  searchBox.addEventListener('input', filterBooks);
  statusFilter.addEventListener('change', filterBooks);
  const toolbar = () => h('div', { class: 'lib-toolbar' }, searchBox, statusFilter, sortSelect, viewToggle);

  let body;
  if (!books.length) {
    body = h('section', { class: 'empty library-welcome' },
      h('div', { class: 'welcome-book', 'aria-hidden': 'true' }, 'Chapter', h('strong', {}, 'One')),
      h('p', { class: 'eyebrow' }, 'THE NEXT CHAPTER IS YOURS'),
      h('h2', {}, 'Make room for your first story.'),
      h('p', {}, 'Bring an idea. Shape the chapter plan. Make every draft your own.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', onClick: () => go('create') }, 'Write my first book →'),
        h('button', { class: 'btn btn-ghost', onClick: () => go('settings') }, 'Connect a provider')),
      writingSteps());
  } else if (view === 'list') {
    const list = h('div', { class: 'book-list' });
    list.append(h('div', { class: 'book-row head' },
      h('span', { class: 'c-cover' }, ''),
      h('span', { class: 'c-title' }, 'Name'),
      h('span', { class: 'c-aud' }, 'Audience'),
      h('span', { class: 'c-genre' }, 'Genre'),
      h('span', { class: 'c-prog' }, 'Length'),
      h('span', { class: 'c-status' }, 'Status'),
      h('span', { class: 'c-date' }, 'Created')));
    const searchKey = (b) => `${b.title || ''} ${b.author || ''} ${b.genre || ''}`.toLowerCase();
    for (const b of books) {
      const key = searchKey(b);
      const row = h('div', { class: 'book-row', 'data-book-search': key, 'data-book-status': b.status || 'draft', style: q && !key.includes(q) ? 'display:none' : '', onClick: () => go('reader', b.id) },
        coverFor(b, 'thumb'),
        h('span', { class: 'c-title' }, h('button', { class: 'r-title book-title-link', 'aria-label': `Read ${b.title || 'Untitled'}`, onClick: (e) => { e.stopPropagation(); go('reader', b.id); } }, b.title || 'Untitled'), h('span', { class: 'r-by' }, `by ${b.author || 'Anonymous'}`)),
        h('span', { class: 'c-aud' }, classBadge(b.classification)),
        h('span', { class: 'c-genre' }, b.genre || '—'),
        h('span', { class: 'c-prog' }, `${b.chapters}/${b.plannedChapters || b.chapters} ch · ${(b.words || 0).toLocaleString()} w`),
        h('span', { class: 'c-status' }, statusBadge(b)),
        h('span', { class: 'c-date' }, fmtDate(b.createdAt),
          b.status === 'paused' ? h('button', { class: 'btn btn-gold btn-sm', style: 'margin-left:10px', onClick: (e) => { e.stopPropagation(); startResume(b.id); } }, '▶ Continue') : null,
          b.status === 'complete' ? h('button', { class: 'btn btn-ghost btn-sm', style: 'margin-left:10px', title: 'Write the sequel — same world, same cast', onClick: (e) => { e.stopPropagation(); startSequel(b.id); } }, '📚 Sequel') : null));
      list.append(row);
    }
    body = h('div', {},
      toolbar(),
      list);
  } else {
    const grid = h('div', { class: 'book-grid' });
    const searchKey = (b) => `${b.title || ''} ${b.author || ''} ${b.genre || ''}`.toLowerCase();
    for (const b of books) {
      const paused = b.status === 'paused';
      const key = searchKey(b);
      const card = h('article', { class: 'book-card', 'data-book-search': key, 'data-book-status': b.status || 'draft', style: q && !key.includes(q) ? 'display:none' : '' },
        h('button', { class: 'book-open', 'aria-label': `Read ${b.title || 'Untitled'}`, onClick: () => go('reader', b.id) },
          coverFor(b),
          h('span', { class: 'book-heading' }, h('strong', { class: 'book-title' }, b.title || 'Untitled'), h('span', { class: 'book-author' }, `by ${b.author || 'Anonymous'}`))),
        h('div', { class: 'book-meta' },
          h('div', { class: 'stat class-stat' }, classBadge(b.classification)),
          h('div', { class: 'stat', style: 'margin-top:8px' },
            h('span', {}, b.genre || ''),
            statusBadge(b)),
          h('div', { class: 'stat', style: 'margin-top:8px' },
            h('span', {}, `${b.chapters}/${b.plannedChapters || b.chapters} ch`),
            h('span', {}, `${(b.words || 0).toLocaleString()} words`)),
          h('div', { class: 'stat date-row', style: 'margin-top:8px' }, h('span', {}, fmtDate(b.createdAt))),
          paused ? h('button', {
            class: 'btn btn-gold btn-sm', style: 'margin-top:12px;width:100%',
            onClick: (e) => { e.stopPropagation(); startResume(b.id); },
          }, '▶ Continue writing') : null,
          b.status === 'complete' ? h('button', {
            class: 'btn btn-ghost btn-sm', style: 'margin-top:12px;width:100%', title: 'Write the sequel — same world, same cast',
            onClick: (e) => { e.stopPropagation(); startSequel(b.id); },
          }, '📚 Write the sequel') : null));
      grid.append(card);
    }
    body = h('div', {},
      toolbar(),
      grid);
  }
  head.append(h('button', { class: 'btn btn-primary page-action', onClick: () => go('create') }, '+ New Book'));
  mount(h('div', { class: 'view library-view' }, head, overview, body, books.length ? noResults : null, books.length ? resultCount : null));
  filterBooks();
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
/** Downscale an uploaded image to a small JPEG data URI so it's light to store
 *  and to send to Nano Banana as a reference. Resolves { mime, data }. */
function resizePhoto(file, max = 768) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const hgt = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hgt;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
        const uri = canvas.toDataURL('image/jpeg', 0.82);
        const m = /^data:([^;]+);base64,(.*)$/.exec(uri);
        if (m) resolve({ mime: m[1], data: m[2] }); else reject(new Error('Encode failed'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function charactersEditor(values = []) {
  const list = h('div', { class: 'chars-list' });
  const addRow = (c = {}) => {
    let photo = c.photo && c.photo.data ? c.photo : null;
    const thumbImg = h('img', { alt: '', style: photo ? '' : 'display:none' });
    if (photo) thumbImg.src = `data:${photo.mime || 'image/jpeg'};base64,${photo.data}`;
    const placeholder = h('span', { class: 'char-thumb-ph', style: photo ? 'display:none' : '' }, '🙂');
    const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    file.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try {
        photo = await resizePhoto(f);
        thumbImg.src = `data:${photo.mime};base64,${photo.data}`;
        thumbImg.style.display = ''; placeholder.style.display = 'none';
      } catch (err) { toast(`Couldn't use that image: ${err.message}`, 'bad'); }
    });
    const thumb = h('button', { class: 'char-thumb', type: 'button', title: 'Upload a photo so the illustrations resemble them', onClick: () => file.click() }, thumbImg, placeholder);
    const row = h('div', { class: 'char-row' },
      thumb, file,
      h('input', { class: 'char-name', 'aria-label': 'Character name', placeholder: 'Name (e.g. Aanya)', value: c.name || '' }),
      h('input', { class: 'char-role', 'aria-label': 'Character description', placeholder: 'Who they are (e.g. age 5, the brave hero who loves dinosaurs)', value: c.role || '' }),
      h('button', { class: 'icon-btn danger', type: 'button', title: 'Remove', onClick: () => row.remove() }, '✕'));
    row._getPhoto = () => photo;
    list.append(row);
  };
  (values || []).forEach((c) => addRow(c));
  return h('div', { class: 'chars-editor', id: 'chars-editor' },
    h('span', { class: 'mini-label' }, 'Characters (optional) — make it personal'),
    h('span', { class: 'hint', style: 'margin:0 0 8px' }, 'Add characters and who they are. Tap the 🙂 to add a reference photo. Nano Banana sends these photos to Google to guide illustrations; use photos you have permission to share.'),
    list,
    h('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'align-self:flex-start;margin-top:8px', onClick: () => addRow({}) }, '+ Add character'));
}
function readCharacters() {
  const out = [];
  document.querySelectorAll('#chars-editor .char-row').forEach((r) => {
    const name = r.querySelector('.char-name').value.trim();
    const role = r.querySelector('.char-role').value.trim();
    if (name) {
      const c = { name, role };
      const photo = r._getPhoto && r._getPhoto();
      if (photo && photo.data) c.photo = photo;
      out.push(c);
    }
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
// A blank textarea is the scariest screen in the app — give tappable sparks.
const IDEA_SPARKS = [
  { icon: '🕵️', label: 'Cozy mystery', text: 'A slow-burn cozy mystery set in a snowbound lighthouse town, where the new librarian keeps solving crimes the sheriff can’t.' },
  { icon: '🚀', label: 'Space opera', text: 'A found-family space opera: a washed-up cargo pilot inherits a sentient ship and a passenger who is wanted in twelve systems.' },
  { icon: '🏰', label: 'Epic fantasy', text: 'An epic fantasy where magic is dying and the last mapmaker must chart a road no one has survived, guided by a ghost who lies.' },
  { icon: '💼', label: 'Career playbook', text: 'A practical, no-fluff playbook for going from senior engineer to calm, effective engineering leader in 90 days.' },
  { icon: '💰', label: 'Money, simply', text: 'A plain-English guide that finally makes personal finance click for someone in their 20s — index funds, taxes, and buying a first home.' },
  { icon: '❤️', label: 'Second-chance romance', text: 'A warm second-chance romance: two rival food-truck owners forced to share a kitchen for one chaotic festival summer.' },
];
function sparkRow() {
  const row = h('div', { class: 'spark-row' });
  IDEA_SPARKS.forEach((sp) => row.append(h('button', {
    class: 'spark', type: 'button', title: sp.text,
    onClick: () => { const t = $('#f-request'); t.value = sp.text; t.focus(); },
  }, `${sp.icon} ${sp.label}`)));
  row.append(h('button', {
    class: 'spark surprise', type: 'button', title: 'Fill in a random idea',
    onClick: () => { const sp = IDEA_SPARKS[Math.floor(Math.random() * IDEA_SPARKS.length)]; const t = $('#f-request'); t.value = sp.text; t.focus(); },
  }, '🎲 Surprise me'));
  return row;
}

function specForm(values = {}) {
  const v = values;
  return h('div', { class: 'card' },
    h('label', { class: 'field' },
      h('span', {}, 'The book you wish existed'),
      h('textarea', { id: 'f-request', placeholder: 'e.g. A slow-burn cozy mystery set in a snowbound Scottish bakery, with a sharp-witted amateur sleuth and a cast of lovable suspects.' }, v.request || '')),
    sparkRow(),
    h('div', { class: 'form-section-label' }, 'Make it yours'),
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
    h('details', { class: 'brief-details', open: !!(v.pov || v.notes || v.characters?.length) },
    h('summary', {}, 'Characters & creative direction', h('span', {}, 'Optional · add the details that matter to you')),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Point of view (optional)'),
        h('input', { id: 'f-pov', placeholder: 'First person, third limited…', value: v.pov || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Anything else? (optional)'),
        h('input', { id: 'f-notes', placeholder: 'Must-haves, inspirations, no-gos…', value: v.notes || '' }))),
    charactersEditor(v.characters)),
    h('label', { class: 'field checkline', style: 'margin-top:12px' },
      h('input', { type: 'checkbox', id: 'f-review', checked: v.reviewOutline !== false ? 'checked' : false }),
      h('span', {}, '📋 Review the chapter plan before writing begins (edit titles, cut chapters)')));
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
    reviewOutline: !!($('#f-review') && $('#f-review').checked),
    characters: readCharacters(),
    model: s[modelField(s.provider || 'claude')] || '',
    research: !!s.research,
    imageMode: s.imageMode || 'off',
    polish: s.polish !== false,
  };
}

function renderCreate() {
  if (state.view === 'create' && $('#f-request')) state.draftSpec = readSpec();
  const provider = (state.settings && state.settings.provider) || 'claude';
  const ready = state.prereq && state.prereq[provider] && state.prereq[provider].found;
  const head = pageHeading('A NEW BEGINNING', 'Start with an idea', 'A few sentences are enough. You’ll shape the chapter plan before the first draft begins.');

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', id: 'btn-clarify', onClick: onClarify }, ready ? 'Continue →' : 'Connect an AI engine to write'),
    h('button', { class: 'btn btn-ghost', id: 'btn-skip', disabled: !ready, onClick: () => skipToGenerate() }, 'Skip questions & write now'));

  mount(h('div', { class: 'view create-view' }, head, writingSteps(), specForm(state.draftSpec || {}), writingOptions(),
    h('div', { class: 'create-footer' }, actions, h('p', { class: 'hint' }, 'Review is on by default. AI writing uses the provider and billing account you connect.'))));
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
  const head = pageHeading('SMALL READERS, BIG IMAGINATIONS', 'A story just for them', 'Choose their age and a little spark of adventure. Reading level, length, and illustration guidance adapt to your reader.');

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
    charactersEditor(v.characters),
    h('label', { class: 'field checkline', style: 'margin-top:16px' },
      h('input', { type: 'checkbox', id: 'k-review', checked: v.reviewOutline !== false }),
      h('span', {}, 'Review the chapter plan before writing begins')));

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', id: 'btn-kids-go', onClick: onKidsGenerate }, ready ? 'Write the kids book' : 'Connect an AI engine to write'));

  mount(h('div', { class: 'view create-view kids-view' }, head, form, writingOptions(), actions,
    h('p', { class: 'hint' }, 'Read the finished story before sharing it with a child. You can edit every chapter.')));
  if (!ready) $('#btn-kids-go').setAttribute('disabled', 'true');
}
function readKidsSpec() {
  const s = state.settings;
  return {
    request: $('#k-request').value.trim(),
    ageBand: $('#k-age').value,
    kidsLength: $('#k-length') ? $('#k-length').value : 'standard',
    reviewOutline: !!$('#k-review')?.checked,
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
    block.append(h('input', { id: inputId, 'data-q': q.id || q.question, 'aria-label': q.question, placeholder: 'Your answer (optional)' }));
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
    activity: '', activityLog: [], stream: '', streamCh: null,
    engine: (spec && spec.provider) || currentChain()[0] || 'claude', // the real primary engine
    imagesUsed: 0, imagesTotal: 0, // live illustration counter
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
    const proceed = h('button', { class: 'btn btn-primary btn-sm', onClick: () => { closeModal(overlay); resolve(true); } }, 'Yes, illustrate it');
    const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) { closeModal(overlay); resolve(false); } } },
      h('div', { class: 'modal', style: 'max-width:460px' },
        h('h2', { style: 'margin:0 0 6px' }, '🍌 Generate illustrations with Nano Banana?'),
        body,
        h('div', { class: 'btn-row' }, proceed,
          h('button', { class: 'btn btn-ghost btn-sm', autofocus: true, onClick: () => { closeModal(overlay); resolve(false); } }, 'Cancel'))));
    presentModal(overlay, () => { closeModal(overlay); resolve(false); });
    api.estimateImages(spec).then((est) => {
      body.textContent = `This will create ${est.approximate ? 'about ' : ''}~${est.count} illustration${est.count === 1 ? '' : 's'} with ${est.modelLabel} ≈ $${est.cost}. Images are billed by Google to your own Gemini API key.`;
    }).catch(() => { body.textContent = 'Nano Banana will illustrate this book (billed to your Gemini API key).'; });
  });
}

/** Generic confirm modal. Resolves true on confirm, false on cancel/dismiss. */
function confirmDialog(title, message, okLabel) {
  return new Promise((resolve) => {
    const body = h('p', { class: 'hint', style: 'margin-bottom:14px;white-space:pre-wrap' }, message || '');
    const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) { closeModal(overlay); resolve(false); } } },
      h('div', { class: 'modal', style: 'max-width:480px' },
        h('h2', { style: 'margin:0 0 6px' }, title),
        body,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary btn-sm', onClick: () => { closeModal(overlay); resolve(true); } }, okLabel || 'Continue'),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { closeModal(overlay); resolve(false); } }, 'Cancel'))));
    presentModal(overlay, () => { closeModal(overlay); resolve(false); });
  });
}

/** Entry point for all generation: gates Nano Banana on key + cost confirmation. */
async function beginGeneration(spec, answers) {
  // One book at a time: a second run would orphan the first job's progress
  // view and leave it uncancellable. Send the user to the running one instead.
  if (state.job && !state.job.done && !state.job.error) {
    toast('A book is already being written — finish or cancel it first.', 'bad');
    return go('progress');
  }
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
    .then((res) => { j.bookId = res.id; j.done = true; redrawProgress(); revealBook(res.id, j); })
    .catch((err) => { j.error = err.message; redrawProgress(); toast(`Writing paused: ${err.message}`, 'bad'); })
    .finally(() => off && off());
}

/**
 * The book-is-born moment. After minutes of anticipation the biggest emotional
 * beat in the product deserves more than a toast: the finished cover flips in
 * under a shower of confetti.
 */
async function revealBook(bookId, j) {
  let content = null;
  try { content = await api.getBookContent(bookId); } catch (_) { /* fall back to plain toast */ }
  if (!content) return toast('🎉 Your book is ready!', 'ok');
  const mins = j && j.startedAt ? Math.max(1, Math.round((Date.now() - j.startedAt) / 60000)) : null;
  const confetti = h('div', { class: 'confetti' });
  for (let i = 0; i < 60; i++) {
    confetti.append(h('i', { style: `left:${(Math.random() * 100).toFixed(1)}%;animation-delay:${(Math.random() * 1.6).toFixed(2)}s;animation-duration:${(2.4 + Math.random() * 1.8).toFixed(2)}s;background:hsl(${Math.floor(Math.random() * 360)},85%,62%)` }));
  }
  const overlay = h('dialog', { class: 'modal-overlay reveal-overlay' },
    confetti,
    h('div', { class: 'reveal-card' },
      content.cover
        ? h('img', { class: 'reveal-cover', src: content.cover, alt: '' })
        : h('div', { class: 'reveal-cover reveal-cover-ph', style: `background:${coverGradient(content.title)}` }, h('h3', {}, content.title)),
      h('div', { class: 'reveal-meta' },
        h('div', { class: 'reveal-kicker' }, '🎉 Your book is born'),
        h('h2', {}, content.title),
        content.subtitle ? h('p', { class: 'reveal-sub' }, content.subtitle) : null,
        h('p', { class: 'reveal-by' }, `by ${content.author || 'Anonymous'}${mins ? ` · written in ${mins} min` : ''}`),
        h('div', { class: 'btn-row', style: 'margin-top:16px' },
          h('button', { class: 'btn btn-gold', onClick: () => { closeModal(overlay); go('reader', bookId); } }, '📖 Read it now'),
          h('button', { class: 'btn btn-ghost', onClick: () => closeModal(overlay) }, 'Later')))));
  presentModal(overlay);
}
function startResume(id) {
  state.job = newJob({ request: 'Resuming…' });
  const j = state.job;
  j.bookId = id;
  j.resuming = true;
  go('progress');
  const off = api.onProgress((e) => { if (e.jobId === j.jobId) handleProgress(e); });
  api.resumeBook(id, j.jobId)
    .then((res) => { j.bookId = res.id; j.done = true; redrawProgress(); revealBook(res.id, j); })
    .catch((err) => { j.error = err.message; redrawProgress(); toast(`Writing paused again: ${err.message}`, 'bad'); })
    .finally(() => off && off());
}
function redrawProgress() {
  if (state.view === 'progress') renderProgress();
  // Reading a book that's still being written: refresh its live "still writing" banner.
  else if (state.view === 'reader' && state.readerLive) state.readerLive.update();
}

function handleProgress(e) {
  const j = state.job;
  if (!j) return;
  j.phase = e.phase;
  switch (e.phase) {
    case 'influences:start': j.activity = e.message || 'Studying the best authors…'; logActivity(j, '📚', 'Studying the category’s best authors to learn — and surpass — them…'); break;
    case 'influences:done':
      if (e.authors && e.authors.length) { j.influences = e.authors; logActivity(j, '🎓', `Learned from ${e.authors.join(', ')} — now aiming higher`); }
      else if (e.message) { logActivity(j, '⚠️', e.message); toast(e.message, 'bad'); }
      else logActivity(j, '🎓', 'Proceeding with master-level craft');
      break;
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
    case 'chapter:stream': {
      if (e.index !== j.streamCh) return;
      j.stream = e.preview || '';
      // FAST PATH: stream chunks arrive every ~180ms for minutes — a full
      // renderProgress() teardown/rebuild each time thrashes the DOM (janky
      // scroll, lost hover). Patch the preview text in place instead; fall
      // through to a full render only when the preview block isn't mounted yet.
      if (state.view === 'progress') {
        const live = document.querySelector('.live-preview .live-text');
        if (live) {
          live.textContent = j.stream;
          live.append(h('span', { class: 'live-cursor' }, '▍'));
          return;
        }
      }
      break;
    }
    case 'outline:review':
      j.awaitingOutline = true;
      j.activity = 'The plan is ready — review it, then start the writing.';
      logActivity(j, '📋', 'Outline ready for your review — edit titles or cut chapters, then approve.');
      break;
    case 'outline:approved':
      j.awaitingOutline = false;
      if (e.book) j.outline = (e.book.outline || []).map((c) => ({ number: c.number, title: c.title, summary: c.summary }));
      logActivity(j, '✅', `Plan approved — writing ${e.chapters} chapters.`);
      break;
    case 'backmatter:start':
      j.activity = e.message || 'Writing the back-cover blurb…';
      logActivity(j, '📝', 'Writing the back-cover blurb & dedication');
      break;
    case 'chapter:polish':
      j.activity = e.message || `Polishing Chapter ${e.number}`;
      logActivity(j, '✨', `Chapter ${e.number}: editor polish pass`);
      break;
    case 'art:start': {
      j.activity = e.message || 'Illustrating…';
      const how = e.method === 'stock' ? 'sourcing a royalty-free photo'
        : e.method === 'svg' ? 'designing AI vector art (SVG)'
        : e.method === 'nano' ? 'generating an image with Nano Banana'
        : 'creating an illustration';
      logActivity(j, '🎨', `Chapter ${e.number}: ${how}`);
      break;
    }
    case 'art:done': j.imagesUsed = (j.imagesUsed || 0) + 1; logActivity(j, '🖼️', `Chapter ${e.number}: image ready (${j.imagesUsed})`); break;
    case 'image:added':
      if (e.n != null) j.imagesUsed = e.n; else j.imagesUsed = (j.imagesUsed || 0) + 1;
      if (e.total != null) j.imagesTotal = e.total;
      if (e.query) { j.activity = `Adding image ${j.imagesUsed}${j.imagesTotal ? `/${j.imagesTotal}` : ''}: “${e.query}”`; logActivity(j, '🖼️', `Image ${j.imagesUsed}${j.imagesTotal ? `/${j.imagesTotal}` : ''} added: ${e.query}`); }
      break;
    case 'image:error': j.activity = e.message; logActivity(j, '⚠️', e.message || 'Image generation issue'); toast(e.message || 'Image generation issue', 'bad'); break;
    case 'chapter:done':
      if (e.engine) j.engine = e.engine; // reflect the engine that actually wrote it
      j.chapters[e.index] = { number: e.number, title: e.title, words: e.words };
      j.activeIndex = e.index + 1; j.stream = ''; j.streamCh = null;
      logActivity(j, '✅', `Chapter ${e.number}: ${e.title} — done (${(e.words || 0).toLocaleString()} words)`);
      break;
    case 'images':
    case 'image:search':
      if (e.query) { j.activity = `Finding a photo: “${e.query}”`; logActivity(j, '🔎', `Searching: ${e.query}`); }
      break;
    case 'engine:switch':
      if (e.type === 'retrying') { j.activity = `⚠️ ${providerLabel(e.id)} had a ${e.kind} hiccup — retrying (attempt ${(e.attempt || 1) + 1})…`; logActivity(j, '🔄', j.activity); }
      else if (e.type === 'falling-back') { j.activity = `⚠️ ${providerLabel(e.fromId)} hit a ${e.kind} limit — switching to ${providerLabel(e.toId)}…`; logActivity(j, '🔁', j.activity); toast(j.activity, 'bad'); }
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

  const imgMethod = imageMethodLabel(j.spec);
  const stats = h('div', { class: 'stat-row' },
    statCard('Chapters', `${doneCount}/${total || '—'}`),
    statCard('Words written', wordsSoFar.toLocaleString(), 'stat-words'),
    statCard('Elapsed', fmtElapsed(Date.now() - j.startedAt), 'stat-elapsed'),
    statCard('Engine', providerLabel(j.engine || (j.spec && j.spec.provider) || 'claude')),
    imgMethod ? statCard(imgMethod, `${j.imagesUsed || 0}${j.imagesTotal ? ` / ${j.imagesTotal}` : ''}`, 'stat-images') : null);

  // Outline review gate: the reader steers the whole book HERE, before any
  // chapter is written. Editable titles/summaries, removable chapters, approve.
  let reviewCard = null;
  if (j.awaitingOutline && working) {
    const rows = h('div', { class: 'outline-review-list' });
    j.outline.forEach((c, i) => {
      const row = h('div', { class: 'outline-review-row' },
        h('span', { class: 'orn' }, String(i + 1)),
        h('div', { class: 'orfields' },
          h('input', { class: 'or-title', 'aria-label': `Chapter ${i + 1} title`, value: c.title || '' }),
          h('input', { class: 'or-summary', 'aria-label': `Chapter ${i + 1} summary`, value: c.summary || '', placeholder: 'What happens in this chapter…' })),
        h('button', { class: 'icon-btn danger', title: 'Cut this chapter', onClick: () => { row.remove(); } }, '✕'));
      rows.append(row);
    });
    reviewCard = h('div', { class: 'card outline-review' },
      h('p', { class: 'section-title' }, '📋 Your book plan — shape it before a single word is written'),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Retitle chapters, tweak what happens, or cut what you don’t want. Nothing is generated until you approve.'),
      rows,
      h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn btn-primary', onClick: async () => {
          const edited = Array.from(rows.querySelectorAll('.outline-review-row')).map((r) => ({
            title: r.querySelector('.or-title').value.trim(),
            summary: r.querySelector('.or-summary').value.trim(),
          })).filter((c) => c.title);
          if (!edited.length) return toast('Keep at least one chapter.', 'bad');
          await api.approveOutline(j.jobId, edited);
          j.awaitingOutline = false;
          j.outline = edited.map((c, i) => ({ number: i + 1, title: c.title, summary: c.summary }));
          redrawProgress();
          toast('✍️ Plan approved — writing begins.', 'ok');
        } }, '✅ Approve & start writing'),
        h('button', { class: 'btn btn-ghost', onClick: async () => {
          await api.approveOutline(j.jobId, null);
          j.awaitingOutline = false;
          redrawProgress();
        } }, 'Looks great as-is →')));
  }

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
    if (j.bookId && doneCount > 0) {
      actions.append(h('button', { class: 'btn btn-gold', onClick: () => go('reader', j.bookId) }, '📖 Start reading while it writes'));
    }
    actions.append(h('button', { class: 'btn btn-danger', onClick: async () => { await api.cancelGeneration(j.jobId); toast('Stopping…'); } }, 'Pause / Cancel'));
  }

  mount(h('div', { class: 'view' },
    head, bar, stats,
    reviewCard,
    preview,
    reviewCard ? null : h('div', { class: 'progress-grid' },
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
  const navigationId = state.navigationId;
  const readerToken = (state.readerToken || 0) + 1;
  state.readerToken = readerToken;
  state.readerBookId = id;
  if (state.readerKeys) { document.removeEventListener('keydown', state.readerKeys); state.readerKeys = null; }
  if (state.readerMenuCleanup) { state.readerMenuCleanup(); state.readerMenuCleanup = null; }
  if (state.readerAudioEl) { state.readerAudioEl.pause(); state.readerAudioEl = null; }
  let content;
  try { content = await api.getBookContent(id); }
  catch (err) { toast(`Could not open book: ${err.message}`, 'bad'); return go('library'); }
  if (state.view !== 'reader' || state.navigationId !== navigationId || state.readerToken !== readerToken) return;

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
  if (content.blurb) pages.push({ kind: 'back', label: 'About this book' });
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

  const tocDrawer = h('aside', { class: 'toc-drawer', id: 'reader-contents', 'aria-label': 'Table of contents', inert: true });
  const contentEl = h('div', { class: 'reader-content' });
  const progressFill = h('div', { class: 'rf' });
  const pageInfo = h('span', { class: 'page-info' }, '');

  const toggleToc = () => {
    const open = tocDrawer.classList.toggle('open');
    tocDrawer.inert = !open;
    tocButton.setAttribute('aria-expanded', String(open));
  };
  const tocButton = h('button', { class: 'icon-btn', title: 'Contents', 'aria-controls': 'reader-contents', 'aria-expanded': 'false', onClick: toggleToc }, '☰');

  // --- audiobook player (ElevenLabs): per-chapter, on-demand, voice-swappable ---
  const audioCfg = (state.settings && state.settings.audio) || {};
  const audioReady = !!(audioCfg.elevenApiKey && (audioCfg.voiceId || audioCfg.voiceIdKids));
  const bookVoiceDefault = (content.isKids && audioCfg.voiceIdKids) ? audioCfg.voiceIdKids : audioCfg.voiceId;
  let selectedVoice = bookVoiceDefault || '';

  const audioEl = h('audio', { controls: 'controls', class: 'reader-audio', style: 'display:none' });
  state.readerAudioEl = audioEl; // tracked so navigating away stops narration
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
    h('button', { class: 'btn btn-ghost btn-sm', title: 'Narrate every chapter now (cached & resumable) so the whole book is ready', onClick: () => generateFullAudiobook() }, '📖 Generate book'),
    h('button', { class: 'btn btn-gold btn-sm', title: 'Play the whole book start to finish — remembers where you stopped', onClick: () => playWholeBook(false) }, '▶ Whole book'));
  const optsBtn = h('button', { class: 'icon-btn opts-btn', title: 'Show narration options', onClick: (e) => { e.stopPropagation(); audioBar.classList.toggle('compact'); } }, '⋯ Options');
  const audioBar = h('div', { class: 'audio-bar' + (audioReady ? '' : ' hidden') },
    optsBtn, audioOptions, audioSpin, audioLabel, audioEl,
    h('button', { class: 'icon-btn', title: 'Hide player', onClick: (e) => { e.stopPropagation(); wholeBook = false; audioEl.pause(); audioBar.classList.add('hidden'); } }, '✕'));
  // Auto-expand the scrubber while playing (collapse the options); a click on the
  // bar (anywhere that isn't a control) — or the "⋯ Options" button — brings them back.
  audioEl.addEventListener('play', () => audioBar.classList.add('compact'));
  audioBar.addEventListener('click', (e) => {
    if (e.target.closest('audio, button, select, input')) return;
    audioBar.classList.remove('compact');
  });
  let audioBusy = false;
  let wholeBook = false;      // sequential "listen to the whole book" mode
  let wbIndex = -1;           // chapter index currently playing in that mode
  let suppressReset = false;  // true while we auto-advance, so nav doesn't kill audio
  let lastPosSave = 0;
  const setSpin = (on) => { audioSpin.style.display = on ? 'inline-block' : 'none'; };
  const pageIndexForChapter = (ci) => pages.findIndex((p) => p.kind === 'chapter' && p.chIndex === ci);
  const abKey = 'bw.audiobook.pos.' + id;
  const saveAbPos = (index, time) => { try { localStorage.setItem(abKey, JSON.stringify({ index, time: time || 0 })); } catch (_) { /* ignore */ } };
  const loadAbPos = () => { try { return JSON.parse(localStorage.getItem(abKey) || 'null'); } catch (_) { return null; } };
  const clearAbPos = () => { try { localStorage.removeItem(abKey); } catch (_) { /* ignore */ } };
  // Whole-book mode: when a chapter finishes, advance to the next and keep the place.
  audioEl.addEventListener('ended', () => {
    if (!wholeBook) return;
    saveAbPos(wbIndex + 1, 0);
    playChapterSequential(wbIndex + 1, 0);
  });
  audioEl.addEventListener('timeupdate', () => {
    if (!wholeBook || wbIndex < 0) return;
    const now = Date.now();
    if (now - lastPosSave > 4000) { lastPosSave = now; saveAbPos(wbIndex, audioEl.currentTime); }
  });

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
    wholeBook = false; // a single-chapter Listen exits whole-book playback
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
      const voice = audioVoice();
      if (!voice || !state.settings.audio?.elevenApiKey) { toast('Choose a narrator and save an ElevenLabs key in Settings first.', 'bad'); return; }
      const status = await api.audiobookStatus(id, voice);
      if (!status.chapters.some(ch => ch.index === ci && ch.cached)) {
        if (!await confirmDialog('Narrate this chapter before exporting?', 'There is no saved narration for this text, voice, and model. Creating the MP3 sends this chapter to ElevenLabs and uses your paid quota. Cancelling the later Save dialog will not refund generation.', 'Narrate & export')) return;
      }
      const r = await api.exportAudio(id, ci, voice);
      if (r && !r.canceled) { toast('Saved chapter MP3.', 'ok'); await api.openPath(r.path); }
    } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
  }
  // When the chapter changes, stop the old audio and prompt for the new one so
  // narration is unmistakably per-chapter (no stale audio lingering).
  function resetAudioForNewChapter() {
    if (suppressReset) return;          // auto-advance manages its own audio
    if (wholeBook) wholeBook = false;   // manual navigation exits whole-book playback
    try { audioEl.pause(); } catch (_) { /* ignore */ }
    audioEl.style.display = 'none'; setSpin(false);
    audioBar.classList.remove('compact'); // show the options again for the new chapter
    if (audioBar.classList.contains('hidden')) return;
    const pg = pages[cur];
    audioLabel.textContent = pg && pg.kind === 'chapter' ? `Press 🎧 Listen for Chapter ${pg.chIndex + 1}` : 'Open a chapter to listen';
  }
  function audioVoice() {
    const a = state.settings && state.settings.audio;
    return selectedVoice || (content.isKids && a && a.voiceIdKids ? a.voiceIdKids : (a && a.voiceId));
  }
  // Pre-narrate EVERY chapter now (each cached individually so chapter-by-chapter
  // listening keeps working). Cache-aware + resumable: closing midway keeps what's
  // done, and re-running picks up the rest. Any per-chapter ElevenLabs error is
  // reported instead of silently failing the whole run.
  async function generateFullAudiobook() {
    const a = state.settings && state.settings.audio;
    if (!a || !a.elevenApiKey) { toast('Add your ElevenLabs key and pick a voice in Settings → Audiobook.', 'bad'); return go('settings'); }
    const voice = audioVoice();
    if (!voice) { toast('Pick a narration voice first.', 'bad'); return; }
    if (!chapters.length) { toast('This book has no chapters yet.', 'bad'); return; }
    if (audioBusy) return;
    let toDo = chapters.length;
    try { const st = await api.audiobookStatus(id, voice); toDo = st.total - st.have; } catch (_) { /* ignore */ }
    if (toDo === 0) { toast('✅ Every chapter is already narrated — press ▶ Whole book to listen.', 'ok'); return; }
    const voiceName = (voiceSel.selectedOptions[0] && voiceSel.selectedOptions[0].textContent.replace(/^★ /, '')) || 'the selected voice';
    const chars = chapters.reduce((n, c) => n + Math.round((c.words || 0) * 6), 0);
    const ok = await confirmDialog(
      '📖 Generate the whole audiobook?',
      `This narrates every chapter (${chapters.length} total) in ${voiceName}, saving each one so you can listen chapter by chapter or all the way through.\n\n` +
      `• ${toDo} chapter${toDo === 1 ? '' : 's'} still need narrating — the rest are already done and reused for free.\n` +
      `• Up to about ${chars.toLocaleString()} characters of your ElevenLabs quota for a full run.\n` +
      `• Finished chapters are saved. Leaving this screen does not cancel a paid request; if the app closes, running it again reuses finished chapters.`,
      'Generate audiobook');
    if (!ok) return;
    audioBusy = true; wholeBook = false;
    audioBar.classList.remove('hidden'); audioEl.style.display = 'none'; setSpin(true);
    audioLabel.textContent = 'Starting audiobook…';
    const off = api.onFullAudioProgress((p) => {
      if (p.id !== id) return;
      if (p.phase === 'complete') { audioLabel.textContent = 'Finishing…'; return; }
      const idx = (typeof p.index === 'number' ? p.index : p.done) + 1;
      const part = p.chunk && p.chunk.total ? ` · part ${p.chunk.done}/${p.chunk.total}` : '';
      audioLabel.textContent = `Narrating chapter ${idx}/${p.total}${part}…`;
    });
    try {
      const res = await api.generateAudiobook(id, voice);
      setSpin(false);
      if (res.failed && res.failed.length) {
        const f = res.failed[0];
        audioLabel.textContent = `⚠️ ${res.failed.length} chapter(s) failed`;
        toast(`Done ${res.narrated + res.fromCache}/${res.total}. ${res.failed.length} failed — e.g. ch ${f.number}: ${f.error}. Press 📖 again to retry the rest.`, 'bad');
      } else {
        audioLabel.textContent = `✅ Whole book ready (${res.total} chapters)`;
        toast(`✅ Audiobook ready — all ${res.total} chapters narrated. Press ▶ Whole book to listen.`, 'ok');
      }
    } catch (err) {
      setSpin(false);
      toast(`Audiobook failed: ${err.message}`, 'bad');
    } finally { off && off(); audioBusy = false; }
  }
  // Play the whole book start to finish, advancing chapter-by-chapter and
  // remembering the place. Narrates any not-yet-cached chapter on the fly.
  async function playWholeBook(fromStart) {
    const a = state.settings && state.settings.audio;
    if (!a || !a.elevenApiKey) { toast('Add your ElevenLabs key and pick a voice in Settings → Audiobook.', 'bad'); return go('settings'); }
    if (!audioVoice()) { toast('Pick a narration voice first.', 'bad'); return; }
    if (!chapters.length) { toast('This book has no chapters yet.', 'bad'); return; }
    const saved = fromStart ? null : loadAbPos();
    const startIndex = saved && saved.index >= 0 && saved.index < chapters.length ? saved.index : 0;
    const startTime = saved && saved.index === startIndex ? (saved.time || 0) : 0;
    if (saved && (startIndex > 0 || startTime > 2)) toast(`▶ Resuming from chapter ${startIndex + 1}.`, 'ok');
    wholeBook = true;
    audioBar.classList.remove('hidden');
    await playChapterSequential(startIndex, startTime);
  }
  async function playChapterSequential(ci, startTime) {
    if (!wholeBook) return;
    if (ci >= chapters.length) { wholeBook = false; clearAbPos(); audioEl.style.display = 'none'; setSpin(false); audioLabel.textContent = '✅ Finished the audiobook'; toast('✅ Reached the end of the audiobook.', 'ok'); return; }
    wbIndex = ci;
    const pi = pageIndexForChapter(ci);
    if (pi >= 0 && pi !== cur) { suppressReset = true; goPage(pi); suppressReset = false; }
    audioEl.style.display = 'none'; setSpin(true);
    audioLabel.textContent = `▶ Whole book — preparing chapter ${ci + 1}/${chapters.length}…`;
    const off = api.onAudioProgress((p) => {
      if (p.id !== id || p.index !== ci || !p.total) return;
      audioLabel.textContent = `▶ Whole book — narrating ${ci + 1}/${chapters.length} (${p.done}/${p.total})…`;
    });
    try {
      const res = await api.synthChapter(id, ci, audioVoice(), false);
      off && off();
      if (!wholeBook) return; // user stopped while synthesizing
      if (audioEl._url) { URL.revokeObjectURL(audioEl._url); audioEl._url = null; }
      audioEl._url = URL.createObjectURL(dataUriToBlob(res.dataUri));
      audioEl.src = audioEl._url; audioEl.style.display = ''; setSpin(false);
      audioLabel.textContent = `▶ Whole book ${ci + 1}/${chapters.length}: ${res.title}`;
      await applySink(audioEl);
      try { audioEl.currentTime = startTime || 0; } catch (_) { /* ignore */ }
      saveAbPos(ci, startTime || 0);
      audioEl.play().catch(() => {});
    } catch (err) {
      off && off(); setSpin(false); wholeBook = false;
      toast(`Whole-book playback stopped at chapter ${ci + 1}: ${err.message}`, 'bad');
    }
  }

  const bar = h('div', { class: 'reader-bar' },
    h('div', { class: 'reader-heading' },
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Library', onClick: () => go('library') }, '← Library'),
      tocButton,
      h('div', { class: 'title', title: content.title }, content.title),
      classBadge(content.classification)),
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
      h('button', { class: 'btn btn-ghost btn-sm', id: 'r-check', onClick: async (e) => {
        const button = e.currentTarget; button.disabled = true;
        try { await showReadiness(id, (index) => goPage(pageIndexForChapter(index))); }
        finally { button.disabled = false; }
      } }, '✓ Manuscript check'),
      h('details', { class: 'book-tools' }, h('summary', {}, 'Book tools'), h('div', { class: 'book-tools-panel' },
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Book stats: words, reading time, grade level', onClick: () => showBookStats(id) }, 'Stats'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Story bible: premise, style, characters', onClick: () => showStoryBible(id) }, 'Story bible'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Rename book / set author', onClick: () => renameBookModal(id, content) }, 'Title & author'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'Send EPUB to Kindle', onClick: () => sendKindle(id) }, 'Send to Kindle'),
      h('button', { class: 'btn btn-danger btn-sm', title: 'Delete', onClick: () => deleteBook(id) }, 'Delete book'))),
      exportMenu(id)));
  const bookTools = $('.book-tools', bar);
  bookTools.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bookTools.open) { e.preventDefault(); e.stopPropagation(); bookTools.open = false; $('summary', bookTools).focus(); }
  });
  bookTools.addEventListener('focusout', (e) => { if (!bookTools.contains(e.relatedTarget) && !document.querySelector('dialog[open]')) bookTools.open = false; });

  const editBtn = h('button', { class: 'btn btn-ghost btn-sm', id: 'r-edit', title: 'Edit this chapter by hand', onClick: async () => {
    const ci = curChapterIndex(); if (ci < 0) return;
    editBtn.disabled = true;
    try {
      const b = await api.getBook(id);
      if (!isCurrentReader(id, readerToken) || document.querySelector('dialog[open]')) return;
      editChapterModal(id, ci, (b.chapters[ci] || {}).title || `Chapter ${ci + 1}`, (b.chapters[ci] || {}).content || '', () => { saveReaderPos(id, cur); renderReader(id); });
    } catch (e) { toast(e.message, 'bad'); }
    finally { editBtn.disabled = curChapterIndex() < 0; }
  } }, '✏️ Edit');
  const rewriteBtn = h('button', { class: 'btn btn-ghost btn-sm', id: 'r-rewrite', title: 'Have the author rewrite this chapter (with your direction)', onClick: () => {
    const ci = curChapterIndex(); if (ci < 0) return;
    rewriteChapterModal(id, ci, (chapters[ci] || {}).title || `Chapter ${ci + 1}`, () => { saveReaderPos(id, cur); renderReader(id); });
  } }, '↻ Rewrite');
  const historyBtn = h('button', { class: 'btn btn-ghost btn-sm', id: 'r-history', onClick: async () => {
    const ci = curChapterIndex(); if (ci < 0) return;
    historyBtn.disabled = true;
    try { await showRevisionHistory(id, ci, () => { saveReaderPos(id, cur); renderReader(id); }); }
    finally { historyBtn.disabled = curChapterIndex() < 0; }
  } }, 'Revision history');
  const nav = h('div', { class: 'reader-nav' },
    h('button', { class: 'btn btn-ghost btn-sm', id: 'r-prev', onClick: () => step(-1) }, '‹ Prev'),
    editBtn, rewriteBtn, historyBtn,
    pageInfo,
    h('button', { class: 'btn btn-ghost btn-sm', id: 'r-next', onClick: () => step(1) }, 'Next ›'));

  // --- live banner: reading a book that is still being written ---
  // The job lives in the main process, so navigating here doesn't stop it; new
  // chapters are saved as they finish and surface here via a "Load new" button.
  const liveJob = state.job;
  const isGenerating = !!(liveJob && liveJob.bookId === id && !liveJob.done && !liveJob.error);
  const loadedChapters = chapters.length;
  const liveText = h('span', { class: 'live-text' }, '');
  const loadNewBtn = h('button', { class: 'btn btn-gold btn-sm', style: 'display:none', onClick: () => { saveReaderPos(id, cur); renderReader(id); } }, '↻ Load new');
  const liveBanner = h('div', { class: 'live-reading-note', style: isGenerating ? '' : 'display:none' },
    h('span', { class: 'live-dot' }), liveText, loadNewBtn,
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('progress') }, '← Back to progress'));
  const updateLive = () => {
    const j = state.job;
    if (!j || j.bookId !== id) { liveBanner.style.display = 'none'; return; }
    liveBanner.style.display = '';
    const done = j.chapters.filter(Boolean).length;
    const total = j.outline.length || done;
    if (j.done) { liveText.textContent = `✅ Finished — ${done} chapter${done === 1 ? '' : 's'} ready`; loadNewBtn.textContent = '↻ Load finished book'; }
    else if (j.error) { liveText.textContent = `⏸️ Writing paused — ${done} chapter${done === 1 ? '' : 's'} so far`; loadNewBtn.textContent = '↻ Load latest'; }
    else { liveText.textContent = `✍️ Still writing — chapter ${Math.min(done + 1, total)} of ${total}`; loadNewBtn.textContent = '↻ Load new'; }
    loadNewBtn.style.display = (done > loadedChapters || j.done || j.error) ? '' : 'none';
  };
  if (isGenerating) updateLive();
  // Register so book:progress events refresh this banner while the user reads.
  state.readerLive = isGenerating ? { id, update: updateLive } : null;

  const main = h('div', { class: 'reader-main', role: 'region', 'aria-label': 'Book text', tabindex: '0' },
    isGenerating ? liveBanner : (paused && content.pausedReason
      ? h('div', { class: 'pause-note' }, `⏸️ ${content.pausedReason.detail || 'Paused.'} `,
          h('button', { class: 'btn btn-gold btn-sm', onClick: () => startResume(id) }, '▶ Continue writing'))
      : null),
    contentEl);

  root.append(bar, h('div', { class: 'reader-progress' }, progressFill), audioBar, h('div', { class: 'reader-body' }, tocDrawer, main), nav);
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
        onClick: () => { goPage(i); if (window.innerWidth < 760) { toggleToc(); tocButton.focus(); } },
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
        content.dedication ? h('div', { class: 'fm-dedication' }, content.dedication) : null,
        content.premise ? h('div', { class: 'fm-preface' }, h('div', { class: 'fm-preface-label' }, 'Preface'), h('p', {}, content.premise)) : null));
  }
  function backEl() {
    return h('section', { class: 'epub-chapter front-matter' },
      h('div', { class: 'titlepage backpage' },
        h('div', { class: 'fm-preface-label' }, 'About this book'),
        h('p', { class: 'fm-blurb' }, content.blurb),
        h('div', { class: 'fm-author', style: 'margin-top:24px' }, `${content.title} · by ${content.author || 'Anonymous'}`)));
  }
  function pageEl(pg, i) {
    if (pg.kind === 'cover') { const c = coverEl(); c.setAttribute('data-i', i); return c; }
    if (pg.kind === 'preface') { const p = prefaceEl(); p.setAttribute('data-i', i); return p; }
    if (pg.kind === 'back') { const p = backEl(); p.setAttribute('data-i', i); return p; }
    const sec = h('section', { class: 'epub-chapter', 'data-i': i });
    sec.innerHTML = pg.html;
    return sec;
  }
  function renderBody() {
    contentEl.innerHTML = '';
    if (!pages.length) { contentEl.append(h('p', { style: 'text-align:center;color:#999' }, 'No content yet.')); return; }
    if (prefs.mode === 'scroll') {
      pages.forEach((pg, i) => contentEl.append(pageEl(pg, i)));
      nav.style.display = 'flex';
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
    editBtn.disabled = curChapterIndex() < 0;
    rewriteBtn.disabled = curChapterIndex() < 0;
    historyBtn.disabled = curChapterIndex() < 0;
    const pg = pages[cur];
    pageInfo.textContent = pg?.kind === 'chapter' ? `Chapter ${pg.chIndex + 1} of ${chapters.length}` : (pg?.label || '');
    const prev = document.getElementById('r-prev'); const next = document.getElementById('r-next');
    if (prev) prev.disabled = cur <= 0;
    if (next) next.disabled = cur >= pages.length - 1;
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
    // Don't hijack keys while the user is in a control (voice picker, note
    // field) or a modal is open — arrows in a <select> must move the selection,
    // and Escape should close the modal, not exit the reader.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (document.querySelector('.modal-overlay, .export-list:not([hidden])')) return;
    if (e.defaultPrevented) return;
    if (e.key === 'ArrowRight' && prefs.mode === 'chapter') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' && prefs.mode === 'chapter') { e.preventDefault(); step(-1); }
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
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
    h('div', { class: 'modal', style: 'max-width:460px' },
      h('h2', { style: 'margin:0 0 6px' }, 'Email this book as a PDF'),
      h('p', { class: 'hint', style: 'margin-bottom:12px' }, subline),
      h('label', { class: 'field' }, h('span', {}, 'Recipient email'), input),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-sm', onClick: doSend }, '✉ Send PDF'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Cancel'))));
  presentModal(overlay);
  setTimeout(() => input.focus(), 30);
  async function doSend() {
    const to = input.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Enter a valid email address.', 'bad'); return; }
    closeModal(overlay);
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
/** Export dropdown: every format a finished book can become. */
function exportMenu(id) {
  const wrap = h('div', { class: 'export-menu' });
  const menu = h('div', { class: 'export-list', id: 'reader-export-options', hidden: true });
  const setOpen = (open, focus = false) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (focus) (open ? menu.querySelector('button') : btn).focus();
  };
  const item = (label, hint, fn) => h('button', { class: 'export-item', title: hint, onClick: async (e) => {
    e.stopPropagation(); setOpen(false, true);
    try {
      const res = await fn();
      if (res && res.path) { toast(`Saved ${res.path.split(/[\\/]/).pop()}`, 'ok'); api.revealPath && api.revealPath(res.path); }
    } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
  } }, label);
  menu.append(
    item('📕 EPUB', 'Reflowable ebook for Kindle/Apple Books/Kobo', () => api.exportBook(id, 'epub', true)),
    item('📄 PDF', 'A4 PDF for screens & printing', () => api.exportBook(id, 'pdf', true)),
    item('🖨️ Print PDF (6×9)', '6×9 interior; review margins and layout before printing', () => api.exportBook(id, 'pdf-print', true)),
    item('📝 Word (.docx)', 'For human editors and beta readers', () => api.exportBook(id, 'docx', true)),
    item('🌐 Web page (.html)', 'A single file you can share with anyone', () => api.exportBook(id, 'html', true)),
    item('⬇︎ Markdown', 'The full manuscript as plain Markdown', () => api.exportBook(id, 'markdown', true)),
    item('✉️ Email a PDF…', 'Compose an email with the PDF attached', async () => { emailPdfModal(id, ''); return null; }));
  const btn = h('button', { class: 'btn btn-ghost btn-sm', title: 'Export this book', 'aria-controls': 'reader-export-options', 'aria-expanded': 'false', onClick: (e) => {
    e.stopPropagation();
    setOpen(menu.hidden, true);
  } }, '⤓ Export');
  const outside = (event) => { if (!wrap.contains(event.target)) setOpen(false); };
  document.addEventListener('click', outside);
  wrap.addEventListener('focusout', (event) => { if (!wrap.contains(event.relatedTarget)) setOpen(false); });
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); event.stopPropagation(); setOpen(false, true); }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [...menu.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      setOpen(true);
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length].focus();
    }
  });
  state.readerMenuCleanup = () => document.removeEventListener('click', outside);
  wrap.append(btn, menu);
  return wrap;
}

/** Author-pride numbers: words, reading time, grade level, pages. */
async function showBookStats(id) {
  let s;
  try { s = await api.bookStats(id); } catch (e) { return toast(e.message, 'bad'); }
  const row = (k, v) => h('div', { class: 'stat-line' }, h('span', {}, k), h('strong', {}, v));
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
    h('div', { class: 'modal stats-modal' },
      h('h2', { style: 'margin:0 0 12px' }, '📊 Book stats'),
      row('Words', (s.words || 0).toLocaleString()),
      row('Chapters', s.chapters),
      row('Paperback pages (est.)', `≈ ${s.pages}`),
      row('Reading time', `≈ ${s.readingMinutes} min`),
      row('Listening time', `≈ ${s.listeningMinutes} min`),
      s.fkGrade != null ? row('Reading level', `${s.fkLabel} (FK ${s.fkGrade})`) : null,
      s.classification ? row('Audience', s.classification.label) : null,
      h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Close'))));
  presentModal(overlay);
}

/** Story bible: the gorgeous planning artifacts the pipeline already made. */
async function showStoryBible(id) {
  let b;
  try { b = await api.getBook(id); } catch (e) { return toast(e.message, 'bad'); }
  const sec = (t, body) => body ? h('div', { class: 'bible-sec' }, h('h3', {}, t), typeof body === 'string' ? h('p', {}, body) : body) : null;
  const chars = (b.characters || []).length
    ? h('ul', {}, ...(b.characters || []).map((c) => h('li', {}, `${c.name}${c.role ? ` — ${c.role}` : ''}`)))
    : null;
  const authors = b.influences && (b.influences.authors || []).length
    ? h('ul', {}, ...b.influences.authors.map((a) => h('li', {}, `${a.name}${a.signature ? ` — ${a.signature}` : ''}`)))
    : null;
  const outline = (b.outline || []).length
    ? h('ol', {}, ...b.outline.map((c) => h('li', {}, h('strong', {}, c.title), c.summary ? ` — ${c.summary}` : '')))
    : null;
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
    h('div', { class: 'modal bible-modal' },
      h('h2', { style: 'margin:0 0 4px' }, '📖 Story bible'),
      h('p', { class: 'hint', style: 'margin:0 0 12px' }, 'Everything the author planned before writing — premise, voice, cast, and the chapter map.'),
      sec('Premise', b.premise), sec('Logline', b.logline),
      sec('Style guide', b.styleGuide),
      (b.themes || []).length ? sec('Themes', (b.themes || []).join(' · ')) : null,
      chars ? sec('Characters', chars) : null,
      authors ? sec('Studied & set out to surpass', authors) : null,
      b.blurb ? sec('Back-cover blurb', b.blurb) : null,
      outline ? sec('Chapter map', outline) : null,
      h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Close'))));
  presentModal(overlay);
}

/** Rename the book / set your name as author — it's YOUR book. */
function renameBookModal(id, content) {
  const t = h('input', { value: content.title || '' });
  const st = h('input', { value: content.subtitle || '', placeholder: 'Subtitle (optional)' });
  const au = h('input', { value: content.author || '', placeholder: 'Author name' });
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 12px' }, '✏️ Rename this book'),
      h('label', { class: 'field' }, h('span', {}, 'Title'), t),
      h('label', { class: 'field' }, h('span', {}, 'Subtitle'), st),
      h('label', { class: 'field' }, h('span', {}, 'Author'), au),
      h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn btn-primary btn-sm', onClick: async () => {
          if (!t.value.trim()) { t.setAttribute('aria-invalid', 'true'); t.focus(); toast('Give the book a title before saving.', 'bad'); return; }
          try {
            await api.updateBook(id, { title: t.value.trim(), subtitle: st.value.trim(), author: au.value.trim() });
            closeModal(overlay); toast('Saved.', 'ok'); renderReader(id);
          } catch (err) { toast(err.message, 'bad'); }
        } }, 'Save'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Cancel'))));
  presentModal(overlay);
  t.focus();
}

/** Hand-edit a chapter's Markdown. */
function editChapterModal(id, chIndex, chapterTitle, markdown, onSaved) {
  const ta = h('textarea', { class: 'edit-chapter-ta', 'aria-label': 'Chapter Markdown', spellcheck: 'true' }, markdown || '');
  const wordCount = h('span', { class: 'editor-count', role: 'status' });
  const updateCount = () => { wordCount.textContent = `${ta.value.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words · ${ta.value === markdown ? 'No changes' : 'Unsaved changes'}`; };
  ta.addEventListener('input', updateCount); updateCount();
  let dismissing = false;
  const dismiss = async () => {
    if (dismissing) return;
    dismissing = true;
    if (ta.value === markdown || await confirmDialog('Discard unsaved edits?', 'Your saved chapter is unchanged. The text in this editor has not been saved.', 'Discard edits')) closeModal(overlay);
    dismissing = false;
  };
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) dismiss(); } },
    h('div', { class: 'modal edit-modal' },
      h('p', { class: 'eyebrow' }, 'MAKE IT YOUR OWN'),
      h('h2', { style: 'margin:0 0 4px' }, chapterTitle),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Edit in Markdown. Saving keeps the previous version in Revision history and updates future exports and narration.'),
      ta,
      wordCount,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { class: 'btn btn-primary btn-sm', onClick: async (e) => {
          const btn = e.currentTarget; btn.disabled = true;
          try {
            await api.updateChapter(id, chIndex, ta.value);
            closeModal(overlay); toast('Chapter saved.', 'ok'); if (onSaved) onSaved();
          } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
        } }, 'Save chapter'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: dismiss }, 'Cancel'))));
  presentModal(overlay, dismiss);
  const preventDirtyClose = (event) => {
    if (overlay.open && ta.value !== markdown) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', preventDirtyClose);
  overlay.addEventListener('close', () => window.removeEventListener('beforeunload', preventDirtyClose), { once: true });
}

function isCurrentReader(id, token) {
  return state.view === 'reader' && state.readerBookId === id && state.readerToken === token;
}
/** Read-only checks run locally; a finding links directly to its chapter. */
async function showReadiness(id, openChapter) {
  const token = state.readerToken;
  try {
    const report = await api.bookReadiness(id);
    if (!isCurrentReader(id, token) || document.querySelector('dialog[open]')) return;
    const summary = report.summary;
    const overlay = h('dialog', { class: 'modal-overlay' });
    const checks = h('div', { class: 'readiness-checks' });
    for (const check of report.checks) {
      checks.append(h('article', { class: `readiness-item severity-${check.severity}` },
        h('span', { class: 'readiness-severity' }, check.severity === 'error' ? 'Needs attention' : 'Review'),
        h('h3', {}, check.title), h('p', {}, check.detail),
        check.excerpt ? h('blockquote', {}, check.excerpt) : null,
        Number.isInteger(check.chapterIndex) && check.chapterAvailable !== false ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => { closeModal(overlay); openChapter(check.chapterIndex); $('.reader-main')?.focus(); } }, `Open chapter ${check.chapterNumber || check.chapterIndex + 1} →`) : null));
    }
    if (!report.checks.length) checks.append(h('div', { class: 'readiness-clear' },
      h('strong', {}, 'No structural issues found'), h('p', {}, 'A good point to read through your manuscript and make it your own.')));
    overlay.append(h('div', { class: 'modal readiness-modal' },
      h('p', { class: 'eyebrow' }, 'A SECOND LOOK, WITHOUT AN AI REQUEST'),
      h('h2', {}, 'Manuscript check'),
      h('p', { class: 'hint' }, 'Checks your current saved manuscript. Run it again after making changes.'),
      h('div', { class: 'review-summary' },
        h('span', {}, h('strong', {}, summary.errors), ' need attention'),
        h('span', {}, h('strong', {}, summary.warnings), ' to review'),
        h('span', {}, h('strong', {}, summary.words.toLocaleString()), ' words')),
      checks, h('p', { class: 'hint' }, report.limitations),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-sm', onClick: () => closeModal(overlay) }, 'Back to manuscript'))));
    presentModal(overlay);
  } catch (error) { toast(`Could not check manuscript: ${error.message}`, 'bad'); }
}

/** Compare safe plain text; saved manuscript HTML never enters this dialog. */
async function showRevisionHistory(id, index, onRestored) {
  const token = state.readerToken;
  try {
    const [history, book] = await Promise.all([api.getChapterRevisions(id, index), api.getBook(id)]);
    if (!isCurrentReader(id, token) || document.querySelector('dialog[open]')) return;
    const chapter = book.chapters[index];
    const overlay = h('dialog', { class: 'modal-overlay' });
    const body = h('div', { class: 'revision-body' });
    const reasonLabel = { 'manual-edit': 'Before an edit', 'ai-rewrite': 'Before an AI rewrite', restore: 'Before a restore' };
    const select = h('select', { id: 'revision-select', 'aria-label': 'Saved chapter version' });
    history.revisions.forEach((r) => select.append(h('option', { value: r.id }, `${fmtDate(r.createdAt)} · ${reasonLabel[r.reason] || 'Saved version'} · ${r.words} words`)));
    const oldText = h('pre', { class: 'revision-text', tabindex: '0', 'aria-label': 'Saved version text' });
    const restore = h('button', { class: 'btn btn-primary btn-sm', id: 'revision-restore', disabled: true }, 'Restore this version');
    const message = h('p', { class: 'hint', role: 'status' });
    let selected = null;
    let loadNumber = 0;
    async function loadVersion() {
      const currentLoad = ++loadNumber; selected = null; restore.disabled = true;
      oldText.textContent = 'Loading saved version…'; message.textContent = '';
      try {
        const version = await api.getChapterRevision(id, index, select.value);
        if (currentLoad !== loadNumber || !overlay.open) return;
        selected = version; oldText.textContent = version.content;
        restore.disabled = version.content === chapter.content;
        const difference = version.words - (chapter.words || 0);
        message.textContent = restore.disabled ? 'This version matches your current chapter.' : `Saved version has ${Math.abs(difference)} ${difference >= 0 ? 'more' : 'fewer'} words than the current chapter.`;
      } catch (error) { if (currentLoad === loadNumber) { oldText.textContent = 'Could not load this version.'; message.textContent = error.message; } }
    }
    select.addEventListener('change', loadVersion);
    restore.addEventListener('click', async () => {
      if (!selected) return;
      const target = selected;
      if (!await confirmDialog('Restore this chapter version?', 'Your current chapter will be saved in Revision history first. Only the chapter text changes; the title, plan, and artwork stay as they are.', 'Restore version')) return;
      restore.disabled = true;
      try {
        await api.restoreChapterRevision(id, index, target.id);
        closeModal(overlay); toast('Version restored. Your previous text is saved in Revision history.', 'ok'); onRestored();
      } catch (error) { toast(error.message, 'bad'); restore.disabled = false; }
    });
    if (history.revisions.length) body.append(
      h('label', { class: 'field' }, h('span', {}, 'Choose a saved version'), select), message,
      h('div', { class: 'revision-compare' },
        h('section', {}, h('h3', {}, 'Saved version'), oldText),
        h('section', {}, h('h3', {}, 'Current chapter'), h('pre', { class: 'revision-text', tabindex: '0', 'aria-label': 'Current chapter text' }, chapter.content))), restore);
    else body.append(h('div', { class: 'revision-empty' }, h('h3', {}, 'Your next edit starts the story.'),
      h('p', {}, 'When you save an edit or finish an AI rewrite, the previous chapter text appears here. You can then compare and restore it.')));
    overlay.append(h('div', { class: 'modal revision-modal' }, h('p', { class: 'eyebrow' }, 'WRITE WITH ROOM TO EXPERIMENT'),
      h('h2', {}, 'Revision history'), h('p', { class: 'hint' }, `${chapter.title || `Chapter ${index + 1}`} · Up to ${history.limit} previous versions, saved on this device.`),
      body, h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Close history'))));
    presentModal(overlay);
    if (history.revisions.length) loadVersion();
  } catch (error) { toast(`Could not load revision history: ${error.message}`, 'bad'); }
}

/** AI rewrite of one chapter, steered by a director's note. */
function rewriteChapterModal(id, chIndex, chapterTitle, onDone) {
  const note = h('textarea', { class: 'rewrite-note', 'aria-label': 'Rewrite instructions', placeholder: 'e.g. Slower pacing, more dialogue between the sisters, end on a cliffhanger — or leave blank for a general polish.' });
  let activeJob = null;
  let dismissed = false;
  const dismiss = async () => {
    if (dismissed) return;
    dismissed = true;
    if (activeJob) {
      try { await api.cancelGeneration(activeJob); }
      catch (error) { dismissed = false; toast(`Could not cancel rewrite: ${error.message}`, 'bad'); return; }
    }
    closeModal(overlay);
  };
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) dismiss(); } },
    h('div', { class: 'modal edit-modal' },
      h('h2', { style: 'margin:0 0 4px' }, `↻ Rewrite — ${chapterTitle}`),
      h('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Describe the change. A successful rewrite saves the previous text in Revision history. This uses provider quota; cancelling cannot refund usage already incurred.'),
      note,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { class: 'btn btn-gold btn-sm', onClick: async (e) => {
          const btn = e.currentTarget;
          btn.setAttribute('disabled', 'true'); btn.textContent = 'Rewriting…';
          activeJob = `rewrite-${Date.now()}`;
          try {
            await api.rewriteChapter(id, chIndex, note.value.trim(), activeJob);
            if (dismissed) return;
            closeModal(overlay); toast('✨ Chapter rewritten.', 'ok'); if (onDone) onDone();
          } catch (err) { if (!dismissed) { btn.removeAttribute('disabled'); btn.textContent = '↻ Rewrite with AI'; toast(err.message, 'bad'); } }
          finally { activeJob = null; }
        } }, '↻ Rewrite with AI'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: dismiss }, 'Cancel'))));
  presentModal(overlay, dismiss);
  note.focus();
}

async function deleteBook(id) {
  if (!await confirmDialog('Delete this book?', 'The manuscript, revision history, artwork, and narration will be permanently deleted. Export a copy first if you want to keep it.', 'Delete book')) return;
  try {
    await api.deleteBook(id);
    toast('Book deleted.');
    go('library');
  } catch (err) { toast(`Could not delete book: ${err.message}`, 'bad'); }
}

function providerStatusRow(key, label) {
  const p = state.prereq || {};
  const npmOk = !!(p.npm && p.npm.found);
  const info = p[key];
  const ok = info && info.found;
  const a = authOf(key);
  const isG = key === 'gemini'; // Gemini = API key + connectivity, not sign-in
  const dot = !ok ? 'bad' : (a ? (a.signedIn ? 'ok' : 'warn') : 'warn');
  const chipText = isG
    ? (a ? (a.signedIn ? '✓ Connected' : (hasImageKey() ? 'Key not reachable' : 'Needs API key')) : 'Testing…')
    : (a ? (a.signedIn ? '✓ Signed in' : a.signedIn === false ? 'Not signed in' : 'Status unavailable') : 'Checking…');
  const authChip = !ok ? null : h('span', {
    style: `font-size:11px;padding:3px 9px;border-radius:20px;font-weight:600;${a ? (a.signedIn ? 'color:var(--ok);background:rgba(31,170,107,.14)' : 'color:var(--accent-2);background:rgba(192,138,46,.16)') : 'color:var(--text-dim)'}`,
  }, chipText);
  const actions = [
    h('span', { style: 'color:var(--text-dim);font-size:12px' }, ok ? (info.version || 'found') : (isG ? 'API key' : 'not installed')),
    authChip,
  ];
  if (!ok && !isG) actions.push(h('button', {
    class: 'btn btn-gold btn-sm',
    title: npmOk ? `Install ${label} via npm` : 'Requires npm (install Node.js first)',
    onClick: () => openInstallModal(key),
  }, '⬇ Install'));
  if (isG) actions.push(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal('gemini') }, a && a.signedIn ? '🔑 API key' : '🔑 Add API key'));
  else if (!(a && a.signedIn)) actions.push(h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal(key) }, '🔑 Sign in'));
  return h('div', { class: 'kv provider-status', 'data-provider': key, 'data-label': label },
    h('span', { class: 'k' }, h('span', { class: `status-dot ${dot}` }), label),
    h('span', { style: 'display:flex;align-items:center;gap:10px' }, ...actions.filter(Boolean)));
}

// ---------- SETTINGS ----------
function renderSettings() {
  const s = state.settings;
  const head = pageHeading('MAKE YOURSELF AT HOME', 'Settings', 'Connect one writing provider to begin. Illustrations, narration, and Kindle delivery are optional.');

  const engineCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'AI engines, models & fallback chain'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' }, 'ChapterOne uses your local Claude Code, Codex and Grok CLIs. “Use subscription” removes known API-key environment variables; confirm your billing account in each CLI. Gemini uses its separately billed API. Prompts and manuscript context are sent to providers in your chain, and research enables web tools. ChapterOne has no backend.'),
    engineBar(),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('label', { class: 'field' }, h('span', {}, 'Claude command'),
        h('input', { id: 's-claude-cmd', value: s.claudeCommand || 'claude' })),
      h('label', { class: 'field' }, h('span', {}, 'Codex command'),
        h('input', { id: 's-codex-cmd', value: s.codexCommand || 'codex' })),
      h('label', { class: 'field' }, h('span', {}, 'Grok command'),
        h('input', { id: 's-grok-cmd', value: s.grokCommand || 'grok' }))),
    providerStatusRow('claude', 'Claude Code CLI'),
    providerStatusRow('codex', 'Codex CLI'),
    providerStatusRow('gemini', 'Gemini API'),
    providerStatusRow('grok', 'Grok CLI'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost btn-sm', onClick: saveEngineCmds }, 'Save commands'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheck() }, 'Re-check CLIs'),
      h('button', { class: 'btn btn-ghost btn-sm', id: 'btn-auth', onClick: testAuth }, 'Check sign-in')));

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
      'On macOS, ChapterOne opens a Mail draft with the file attached. On Windows, it opens the folder so you can attach the file in your mail app or upload it to Send to Kindle. Use SMTP for automatic delivery on either platform.'),
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
  const selectedImageModel = imgs.model || state.models.defaultImageModel || '';
  imageModels.forEach((m) => imgModelSel.append(h('option', { value: m.id, selected: m.id === selectedImageModel ? 'selected' : false }, m.label + (m.price ? ` (~$${m.price}/img)` : ''))));
  if (selectedImageModel && !imageModels.some(m => m.id === selectedImageModel)) {
    imgModelSel.append(h('option', { value: selectedImageModel, selected: true }, `Saved: ${selectedImageModel}`));
  }
  const imageNote = h('p', { class: 'hint image-model-note' });
  const updateImageNote = () => { imageNote.textContent = [imageModels.find(m => m.id === imgModelSel.value)?.note,
    'Estimates cover standard 1K image output only; input and thinking tokens cost extra.'].filter(Boolean).join(' '); };
  imgModelSel.addEventListener('change', updateImageNote);
  updateImageNote();
  const imageCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'Gemini API key · illustrations & Gemini engine'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Your Gemini API key powers two optional features: Nano Banana illustrations, and the Gemini writing engine (Gemini runs through the API in this app and is billed separately from CLI subscriptions). One key from aistudio.google.com/apikey covers both. Stored locally on this computer.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Gemini API key (engine + images)'),
        h('input', { id: 's-img-key', type: 'password', value: imgs.geminiApiKey || '', placeholder: 'AIza…' })),
      h('label', { class: 'field' }, h('span', {}, 'Image model'), imgModelSel)),
    imageNote,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary btn-sm', onClick: saveImages }, 'Save'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: verifyImages }, 'Test key')));

  const aud = s.audio || {};
  const audModels = state.models.audioModels || [{ id: 'eleven_multilingual_v2', label: 'Multilingual v2' }];
  const audModelSel = h('select', { id: 's-aud-model' });
  audModels.forEach((m) => audModelSel.append(h('option', { value: m.id, selected: m.id === (aud.model || 'eleven_multilingual_v2') ? 'selected' : false }, m.label)));
  if (aud.model && !audModels.some(m => m.id === aud.model)) {
    audModelSel.append(h('option', { value: aud.model, selected: true }, `Saved: ${aud.model}`));
  }
  const voiceBox = h('div', { id: 'voice-pickers', class: 'voice-pickers' },
    h('span', { class: 'hint' }, aud.elevenApiKey ? 'Click “Load voices” to choose your narrators.' : 'Add your ElevenLabs key, Save, then load voices.'));
  const audioCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'Audiobook · ElevenLabs'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Optional. Listen to any book narrated by a top-tier AI voice. Uses your ElevenLabs API key — audio only, stored locally on this computer, separate from your CLI/text subscription and the image key. Get a key at elevenlabs.io. ElevenLabs bills per character; ChapterOne narrates a chapter only when you press 🎧 Listen, and caches it.'),
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

  // Danger zone — wipe every local artifact the app created. Sits at the very
  // bottom and is gated behind a type-to-confirm modal.
  const dangerCard = h('div', { class: 'card danger-card' },
    h('p', { class: 'section-title', style: 'color:var(--danger)' }, 'Danger zone'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Permanently erase everything ChapterOne has stored on this computer: every book and chapter, all generated covers and illustrations, all narrated audio, every export, and your saved settings and API keys. This cannot be undone.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-danger-solid btn-sm', onClick: () => clearAllDataModal() }, '🗑  Clear all my data')));

  const sections = [['writing', 'Writing', engineCard], ['images', 'Illustrations', imageCard], ['audio', 'Narration', audioCard], ['delivery', 'Kindle & email', kindleCard], ['data', 'Your data', dangerCard]];
  const jumpNav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' });
  sections.forEach(([key, label, card]) => {
    card.id = `settings-${key}`;
    card.setAttribute('tabindex', '-1');
    jumpNav.append(h('button', { class: 'settings-jump', onClick: () => { card.scrollIntoView({ block: 'start' }); card.focus({ preventScroll: true }); } }, label));
  });
  mount(h('div', { class: 'view settings-view' }, head, jumpNav, engineCard, imageCard, audioCard, kindleCard, dangerCard));
}

/** Type-to-confirm modal that erases every local artifact the app created. */
function clearAllDataModal() {
  const PHRASE = 'delete all my data';
  const input = h('input', { placeholder: `Type "${PHRASE}" here`, autocomplete: 'off', spellcheck: 'false', style: 'width:100%' });
  const confirmBtn = h('button', { class: 'btn btn-danger-solid btn-sm', disabled: 'true', onClick: doClear }, '🗑  Permanently delete everything');
  input.addEventListener('input', () => {
    if (input.value.trim().toLowerCase() === PHRASE) confirmBtn.removeAttribute('disabled');
    else confirmBtn.setAttribute('disabled', 'true');
  });
  const overlay = h('dialog', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) closeModal(overlay); } },
    h('div', { class: 'modal', style: 'max-width:500px' },
      h('h2', { style: 'margin:0 0 8px;color:var(--danger)' }, '⚠️  Erase ALL ChapterOne data?'),
      h('p', { class: 'hint', style: 'margin-bottom:10px' },
        'This permanently deletes EVERY book, chapter, cover, illustration, audiobook file, export, and your saved settings and API keys on this computer. There is no undo and no backup — anything not exported elsewhere is gone for good.'),
      h('p', { class: 'hint', style: 'margin-bottom:14px;color:var(--text-dim)' },
        'Not affected: your CLI sign-ins, and any voices you already cloned on ElevenLabs (those live on their servers).'),
      h('label', { class: 'field' }, h('span', {}, `To confirm, type:  ${PHRASE}`), input),
      h('div', { class: 'btn-row', style: 'margin-top:16px' },
        confirmBtn,
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => closeModal(overlay) }, 'Cancel'))));
  presentModal(overlay);
  setTimeout(() => input.focus(), 30);

  async function doClear() {
    confirmBtn.setAttribute('disabled', 'true');
    confirmBtn.textContent = 'Deleting…';
    try {
      await api.clearAllData();
      localStorage.clear();
      closeModal(overlay);
      state.settings = await api.getSettings(); // back to fresh defaults
      state.authStatus = null;
      state.draftSpec = null; state.kidsDraft = null; state.libQuery = ''; state.job = null;
      toast('✅ All ChapterOne data cleared — books, images, audio, exports, and settings.', 'ok');
      go('library');
    } catch (err) {
      confirmBtn.removeAttribute('disabled');
      confirmBtn.textContent = '🗑  Permanently delete everything';
      toast(`Could not clear data: ${err.message}`, 'bad');
    }
  }
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
    grokCommand: $('#s-grok-cmd').value.trim() || 'grok',
  });
  await recheck();
  toast('Commands saved.', 'ok');
}
async function testAuth() {
  const btn = $('#btn-auth');
  btn.textContent = 'Testing…'; btn.setAttribute('disabled', 'true');
  try {
    const res = await api.checkAuth();
    toast(res.detail || (res.ok ? 'Sign-in found. Model availability and billing depend on your provider account.' : 'Sign-in status unavailable.'), res.ok ? 'ok' : 'bad');
  } catch (err) { toast(`Test failed: ${err.message}`, 'bad'); }
  finally { btn.textContent = 'Check sign-in'; btn.removeAttribute('disabled'); }
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
  // Platform class so CSS can drop macOS-only chrome (traffic-light padding) on
  // Windows/Linux, where the window has a normal titlebar.
  const plat = /Win/i.test(navigator.platform) ? 'win' : /Mac/i.test(navigator.platform) ? 'mac' : 'linux';
  document.body.classList.add(`platform-${plat}`);
  try { state.settings = await api.getSettings(); } catch (_) { state.settings = { provider: 'claude' }; }
  try { state.models = await api.getModels(); } catch (_) { /* defaults */ }
  await refreshPrereq();
  go('library');
  refreshAuthStatus(); // background: determine which CLIs are signed in
})();
})();
