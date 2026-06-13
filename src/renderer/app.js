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
  models: { claude: [], codex: [] },
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

// ---------- navigation ----------
async function go(view, arg) {
  if (view !== 'reader' && state.readerKeys) { document.removeEventListener('keydown', state.readerKeys); state.readerKeys = null; }
  if (view !== 'progress' && state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
  state.view = view;
  setActiveNav(['library', 'create', 'settings'].includes(view) ? view : 'library');
  if (view === 'library') return renderLibrary();
  if (view === 'create') return renderCreate();
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

  if (active && active.found) {
    pill.className = 'pill ok';
    pill.textContent = `● ${name} · subscription${chainNote}`;
    banner.classList.add('hidden');
  } else {
    pill.className = 'pill bad';
    pill.textContent = `● ${name} not found`;
    const cmd = (state.settings && state.settings[provider + 'Command']) || provider;
    banner.innerHTML = '';
    banner.append(
      h('span', {}, `⚠️ The ${name} CLI (“${cmd}”) was not found, or you’re not signed in. Install it and sign in with your subscription.`),
      h('button', { class: 'btn btn-gold btn-sm', onClick: () => openAuthModal(provider) }, '🔑 Sign in'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheck() }, 'Re-check'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('settings') }, 'Settings'));
    banner.classList.remove('hidden');
  }
}
async function recheck() {
  await refreshPrereq();
  if (state.view === 'create') renderCreate();
  if (state.view === 'settings') renderSettings();
}

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
function imageModeControl() {
  const mode = state.settings.imageMode || 'off';
  const seg = h('div', { class: 'seg' });
  const opts = [
    { v: 'off', l: 'No images' },
    { v: 'ai', l: '🎨 AI-designed art' },
    { v: 'stock', l: '📷 Stock photos' },
  ];
  for (const o of opts) {
    seg.append(h('button', { class: mode === o.v ? 'active' : '', onClick: () => updateSettings({ imageMode: o.v }).then(renderEngineBarInPlace) }, o.l));
  }
  return h('div', { class: 'engine-col grow' },
    h('span', { class: 'mini-label' }, 'Cover & illustrations (one per chapter)'),
    seg,
    h('span', { class: 'hint' }, mode === 'ai'
      ? 'Your selected engine designs a bespoke vector cover and a chapter illustration that match the book’s theme — copyright-free.'
      : mode === 'stock'
        ? 'Sources high-resolution, openly-licensed photos from Openverse, with a credits page.'
        : 'No images will be added.'));
}

function engineBar() {
  const s = state.settings;
  const provider = s.provider || 'claude';
  const seg = h('div', { class: 'seg' });
  for (const p of (state.models.providers || [])) {
    seg.append(h('button', { class: provider === p.id ? 'active' : '', onClick: () => switchProvider(p.id) }, p.label));
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
  let sessionId = null;
  let unsub = null;
  let finished = false;

  const log = h('pre', { class: 'auth-log' }, '');
  const append = (t) => { log.textContent += t; log.scrollTop = log.scrollHeight; };
  const input = h('input', { placeholder: 'Paste a verification code here (if asked), then Send', onkeydown: (e) => { if (e.key === 'Enter') sendInput(); } });
  const urlLine = h('div', { class: 'hint' }, '');

  const close = () => {
    if (unsub) unsub();
    if (sessionId && !finished) api.cancelAuth(sessionId).catch(() => {});
    overlay.remove();
  };
  async function sendInput() {
    if (!sessionId || !input.value.trim()) return;
    await api.authInput(sessionId, input.value);
    append(`> ${input.value}\n`);
    input.value = '';
  }

  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal' },
      h('h2', { style: 'margin:0 0 6px' }, `Sign in to ${providerLabel(provider)}`),
      h('p', { class: 'hint', id: 'auth-hint' }, 'Starting sign-in…'),
      urlLine,
      log,
      h('div', { class: 'auth-input-row' }, input, h('button', { class: 'btn btn-ghost btn-sm', onClick: sendInput }, 'Send')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-gold btn-sm', onClick: async () => {
          const res = await api.checkAuth(provider).catch((e) => ({ ok: false, detail: e.message }));
          if (res.ok) { toast('✅ Signed in.', 'ok'); finished = true; close(); await refreshPrereq(); if (state.view === 'settings') renderSettings(); }
          else toast(`Not signed in yet: ${res.detail || ''}`, 'bad');
        } }, '✓ I’ve finished — re-check'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: close }, 'Close'))));
  document.body.append(overlay);

  unsub = api.onAuthEvents({
    onOutput: (d) => { if (d.provider === provider) append(d.text); },
    onUrl: (d) => { if (d.provider === provider) urlLine.textContent = `Opened sign-in page in your browser: ${d.url}`; },
    onClosed: async (d) => {
      if (d.provider !== provider) return;
      finished = true;
      append(`\n[sign-in process ended, code ${d.code}]\n`);
      if (d.authed) { toast('✅ Signed in.', 'ok'); close(); await refreshPrereq(); if (state.view === 'settings') renderSettings(); }
      else append('If a browser step is still open, finish it and click “I’ve finished — re-check”.\n');
    },
  });

  api.startAuth(provider)
    .then((info) => { sessionId = info.sessionId; $('#auth-hint').textContent = info.hint || 'Follow the prompts to authorize your subscription.'; })
    .catch((err) => append(`Could not start sign-in: ${err.message}\n`));
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
      const coverEl = b.coverSvg
        ? h('div', { class: 'book-cover has-art' }, h('img', { src: svgDataUri(b.coverSvg), alt: '' }))
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
function specForm(values = {}) {
  const v = values;
  return h('div', { class: 'card' },
    h('label', { class: 'field' },
      h('span', {}, 'What do you want to read? Describe the book you wish existed.'),
      h('textarea', { id: 'f-request', placeholder: 'e.g. A slow-burn cozy mystery set in a snowbound Scottish bakery, with a sharp-witted amateur sleuth and a cast of lovable suspects.' }, v.request || '')),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Genre'),
        h('input', { id: 'f-genre', placeholder: 'Mystery, Sci-Fi, Self-help…', value: v.genre || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Target audience'),
        h('input', { id: 'f-audience', placeholder: 'Adults, YA, professionals…', value: v.audience || '' }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Book size'),
        sizeSelect(v.size || (state.settings && state.settings.size) || 'medium')),
      h('label', { class: 'field' }, h('span', {}, 'Tone / style'),
        h('input', { id: 'f-tone', placeholder: 'Warm & witty, dark & gritty…', value: v.tone || '' }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Point of view (optional)'),
        h('input', { id: 'f-pov', placeholder: 'First person, third limited…', value: v.pov || '' })),
      h('label', { class: 'field' }, h('span', {}, 'Anything else? (optional)'),
        h('input', { id: 'f-notes', placeholder: 'Must-haves, inspirations, no-gos…', value: v.notes || '' }))));
}
function readSpec() {
  const s = state.settings;
  return {
    request: $('#f-request').value.trim(),
    genre: $('#f-genre').value.trim(),
    audience: $('#f-audience').value.trim(),
    size: $('#f-size').value,
    tone: $('#f-tone').value.trim(),
    pov: $('#f-pov').value.trim(),
    notes: $('#f-notes').value.trim(),
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
    else startGeneration(spec, {});
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
  startGeneration(spec, {});
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
      startGeneration(state.draftSpec, answers);
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
  let cur = Math.min(Math.max(readerPos(id), 0), Math.max(chapters.length - 1, 0));

  // --- root + bar ---
  const root = h('div', { class: 'view reader-view epub-reader' });
  const setVars = () => {
    root.setAttribute('data-theme', prefs.theme);
    root.setAttribute('data-font', prefs.family);
    root.style.setProperty('--reader-fs', prefs.fontSize + 'px');
  };

  const tocDrawer = h('aside', { class: 'toc-drawer' });
  const contentEl = h('div', { class: 'reader-content' });
  const progressFill = h('div', { class: 'rf' });
  const pageInfo = h('span', { class: 'page-info' }, '');

  const toggleToc = () => tocDrawer.classList.toggle('open');

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

  root.append(bar, h('div', { class: 'reader-progress' }, progressFill), h('div', { class: 'reader-body' }, tocDrawer, main));
  setVars();
  mount(root);

  // --- TOC ---
  function buildToc() {
    tocDrawer.innerHTML = '';
    tocDrawer.append(h('div', { class: 'toc-head' }, 'Contents'));
    chapters.forEach((c, i) => {
      tocDrawer.append(h('button', {
        class: `toc-item ${i === cur ? 'active' : ''}`, 'data-i': i,
        onClick: () => { goChapter(i); if (window.innerWidth < 760) tocDrawer.classList.remove('open'); },
      }, h('span', { class: 'toc-n' }, String(c.number)), c.title));
    });
  }

  // --- rendering ---
  function coverEl() {
    if (!content.cover) return null;
    return h('div', { class: 'reader-cover' }, h('img', { src: content.cover, alt: 'Cover' }));
  }
  function renderBody() {
    contentEl.innerHTML = '';
    if (!chapters.length) { contentEl.append(h('p', { style: 'text-align:center;color:#999' }, 'No chapters yet.')); return; }
    if (prefs.mode === 'scroll') {
      const cv = coverEl(); if (cv) contentEl.append(cv);
      chapters.forEach((c, i) => {
        const sec = h('section', { class: 'epub-chapter', 'data-i': i });
        sec.innerHTML = c.html;
        contentEl.append(sec);
      });
      nav.style.display = 'none';
    } else {
      if (cur === 0) { const cv = coverEl(); if (cv) contentEl.append(cv); }
      const c = chapters[cur];
      const sec = h('section', { class: 'epub-chapter', 'data-i': cur });
      sec.innerHTML = c.html;
      contentEl.append(sec);
      nav.style.display = 'flex';
    }
    updateProgress();
    buildToc();
    contentEl.scrollTop = 0;
    const mainEl = main;
    if (mainEl) mainEl.scrollTop = 0;
  }

  function updateProgress() {
    document.querySelectorAll('.toc-item').forEach((b) => b.classList.toggle('active', Number(b.getAttribute('data-i')) === cur));
    if (prefs.mode === 'chapter') {
      pageInfo.textContent = `Chapter ${cur + 1} of ${chapters.length}`;
      const pct = chapters.length ? ((cur + 1) / chapters.length) * 100 : 0;
      progressFill.style.width = pct + '%';
      const prev = document.getElementById('r-prev'); const next = document.getElementById('r-next');
      if (prev) prev.disabled = cur <= 0;
      if (next) next.disabled = cur >= chapters.length - 1;
    }
  }

  function goChapter(i) {
    cur = Math.min(Math.max(i, 0), chapters.length - 1);
    saveReaderPos(id, cur);
    if (prefs.mode === 'scroll') {
      const sec = contentEl.querySelector(`.epub-chapter[data-i="${cur}"]`);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateProgress();
    } else {
      renderBody();
    }
  }
  function step(d) { goChapter(cur + d); }

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
    contentEl.querySelectorAll('.epub-chapter').forEach((sec) => {
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
  if (!k || !k.toAddress || !k.smtp || !k.smtp.host) {
    toast('Set up your Kindle email & SMTP in Settings first.', 'bad');
    return go('settings');
  }
  toast('Building EPUB and emailing it to Kindle…');
  try { await api.sendToKindle(id); toast('📨 Sent! It will appear on your Kindle shortly.', 'ok'); }
  catch (err) { toast(`Send failed: ${err.message}`, 'bad'); }
}
function emailPdfModal(id, title) {
  const k = state.settings && state.settings.kindle;
  if (!k || !k.smtp || !k.smtp.host || !k.fromAddress) {
    toast('Add your SMTP details and a sender address in Settings first.', 'bad');
    return go('settings');
  }
  const input = h('input', { type: 'email', placeholder: 'name@example.com',
    value: state.settings.pdfEmailTo || '', onkeydown: (e) => { if (e.key === 'Enter') doSend(); } });
  const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'modal', style: 'max-width:460px' },
      h('h2', { style: 'margin:0 0 6px' }, 'Email this book as a PDF'),
      h('p', { class: 'hint', style: 'margin-bottom:12px' }, `“${title}” will be rendered to PDF and sent from ${k.fromAddress} via your SMTP account.`),
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
    toast('Rendering PDF and emailing…');
    try {
      await api.emailPdf(id, to);
      state.settings = await api.getSettings();
      toast(`✉ PDF emailed to ${to}.`, 'ok');
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

  const statusRow = (key, label) => {
    const info = p[key];
    const ok = info && info.found;
    return h('div', { class: 'kv' },
      h('span', { class: 'k' }, h('span', { class: `status-dot ${ok ? 'ok' : 'bad'}` }), label),
      h('span', { style: 'display:flex;align-items:center;gap:10px' },
        h('span', { style: 'color:var(--text-dim);font-size:12px' }, ok ? (info.version || 'found') : 'not installed'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal(key) }, '🔑 Sign in')));
  };

  const engineCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'AI engines, models & fallback chain'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' }, 'Modulagent drives your locally installed CLI on your own subscription. With “Use subscription” on, API-key environment variables are stripped so billing always uses your plan login — never an API key. Research uses each CLI’s built-in web tools (Claude WebSearch/WebFetch, Codex --search, Gemini Google Search). Nothing is sent to any third-party server.'),
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
  const kindleCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'Send to Kindle'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' },
      'Books are emailed straight to your Kindle. Add your “@kindle.com” address from Amazon → Manage Your Content & Devices → Preferences → Personal Document Settings, and add your sender email to the Approved list.'),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Your Kindle address'),
        h('input', { id: 's-k-to', value: k.toAddress || '', placeholder: 'yourname@kindle.com' })),
      h('label', { class: 'field' }, h('span', {}, 'Approved sender (from)'),
        h('input', { id: 's-k-from', value: k.fromAddress || '', placeholder: 'you@gmail.com' }))),
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
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Default delivery format'),
        selectEl('s-k-format', ['epub', 'pdf'], k.preferredFormat || 'epub'))),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-primary btn-sm', onClick: saveKindle }, 'Save'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: verifyKindle }, 'Verify SMTP')));

  mount(h('div', { class: 'view' }, head, engineCard, kindleCard));
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
  await updateSettings({
    kindle: {
      toAddress: $('#s-k-to').value.trim(),
      fromAddress: $('#s-k-from').value.trim(),
      preferredFormat: $('#s-k-format').value,
      smtp: {
        host: $('#s-smtp-host').value.trim(),
        port: Number($('#s-smtp-port').value) || 587,
        secure: Number($('#s-smtp-port').value) === 465,
        user: $('#s-smtp-user').value.trim(),
        pass: $('#s-smtp-pass').value,
      },
    },
  });
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
})();
})();
