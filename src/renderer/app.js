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
  const sel = h('select', { id: 'eng-model' });
  for (const m of list) sel.append(h('option', { value: m.id, selected: m.id === current ? 'selected' : false }, m.label));
  if (current && !known.includes(current)) sel.append(h('option', { value: current, selected: 'selected' }, `Custom: ${current}`));
  sel.append(h('option', { value: '__custom__' }, 'Custom model…'));
  sel.addEventListener('change', async () => {
    if (sel.value === '__custom__') {
      const v = window.prompt('Enter a custom model id for this provider:', current || '');
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

function chainToggles() {
  const s = state.settings;
  const primary = s.provider || 'claude';
  const chain = currentChain();
  const wrap = h('div', { class: 'chain-row' });
  for (const p of (state.models.providers || [])) {
    const inChain = chain.includes(p.id);
    const isPrimary = p.id === primary;
    const order = chain.indexOf(p.id);
    const chip = h('button', {
      class: `chain-chip ${inChain ? 'on' : ''} ${isPrimary ? 'primary' : ''}`,
      title: isPrimary ? 'Primary engine (always first)' : 'Toggle as fallback',
      onClick: async () => {
        if (isPrimary) return; // can't remove primary
        const next = new Set(currentChain());
        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
        // rebuild ordered list
        const ids = (state.models.providers || []).map((x) => x.id);
        const ordered = [primary, ...ids.filter((id) => id !== primary && next.has(id))];
        await updateSettings({ chain: ordered });
        renderEngineBarInPlace();
      },
    },
      h('span', { class: 'chain-order' }, inChain ? `${order + 1}` : '+'),
      ` ${p.label}`,
      isPrimary ? h('span', { class: 'chain-tag' }, 'primary') : null);
    wrap.append(chip);
  }
  return wrap;
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
        seg),
      h('div', { class: 'engine-col grow' },
        h('span', { class: 'mini-label' }, `${providerLabel(provider)} model`),
        modelOptionsFor(provider)),
      h('div', { class: 'engine-col' },
        h('span', { class: 'mini-label' }, 'Account'),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => openAuthModal(provider) }, '🔑 Sign in'))),
    h('div', { class: 'engine-row', style: 'margin-top:14px;flex-direction:column;align-items:stretch;gap:7px' },
      h('span', { class: 'mini-label' }, 'Automatic fallback chain'),
      chainToggles(),
      h('span', { class: 'hint' }, 'If a provider’s quota runs out mid-book, writing continues automatically on the next engine in this chain. Click to add/remove fallbacks.')),
    h('div', { class: 'engine-row toggles' },
      toggle('t-research', s.research, '🔎 Research real facts & sources (web)', (v) => updateSettings({ research: v })),
      toggle('t-illustrate', s.illustrate, '🖼️ Add royalty-free images', (v) => updateSettings({ illustrate: v })),
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
      const card = h('div', { class: 'book-card', onClick: () => go('reader', b.id) },
        h('div', { class: 'book-cover', style: `background:${coverGradient(b.title)}` },
          h('h3', {}, b.title || 'Untitled'),
          h('div', { class: 'by' }, `by ${b.author || 'Anonymous'}`)),
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
      h('label', { class: 'field' }, h('span', {}, 'Length'),
        selectEl('f-length', ['Standard (12–20 ch)', 'Short / novella (6–10 ch)', 'Epic (24–40 ch)'], v.length)),
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
    length: $('#f-length').value,
    tone: $('#f-tone').value.trim(),
    pov: $('#f-pov').value.trim(),
    notes: $('#f-notes').value.trim(),
    model: s.provider === 'codex' ? s.codexModel : s.claudeModel,
    research: !!s.research,
    illustrate: !!s.illustrate,
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
  return { jobId: `job-${Date.now()}`, spec, phase: 'starting', chapters: [], outline: [], title: (spec && spec.request || 'Book').slice(0, 40), bookId: null, error: null, done: false, activity: '' };
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
  if (e.phase === 'outline:done' || e.phase === 'resume') {
    if (e.book) { j.title = e.book.title || j.title; j.outline = e.book.outline || []; j.bookId = e.book.id; j.chapters = (e.book.chapters || []).map((c) => c && { number: c.number, title: c.title, words: c.words }); }
  }
  if (e.phase === 'chapter:start') j.activeIndex = e.index;
  if (e.phase === 'chapter:done') { j.chapters[e.index] = { number: e.number, title: e.title, words: e.words }; j.activeIndex = e.index + 1; }
  if (e.phase === 'images' && e.query) j.activity = `Finding image: “${e.query}”`;
  if (e.phase === 'engine:switch') {
    if (e.type === 'falling-back') { j.activity = `⚠️ ${providerLabel(e.fromId)} hit a ${e.kind} limit — switching to ${providerLabel(e.toId)}…`; toast(j.activity, 'bad'); }
    else if (e.type === 'switched') { j.activity = `Now writing with ${providerLabel(e.toId)}.`; j.engine = e.toId; }
    else if (e.type === 'exhausted') { j.activity = `All providers in the chain failed (${e.kind}).`; }
  }
  if (e.message) j.message = e.message;
  redrawProgress();
}

function renderProgress() {
  const j = state.job;
  if (!j) return go('library');
  const total = j.outline.length;
  const doneCount = j.chapters.filter(Boolean).length;
  const pct = total ? Math.round((doneCount / total) * 100) : (j.phase === 'starting' ? 6 : 12);
  const working = !j.done && !j.error;

  const head = h('div', { class: 'progress-head' },
    working ? h('div', { class: 'spinner' }) : h('div', { style: 'font-size:24px' }, j.error ? '⏸️' : '✅'),
    h('div', {},
      h('h1', { style: 'margin:0;font-size:22px' }, j.done ? j.title : (j.error ? 'Writing paused' : 'Writing your book…')),
      h('p', { style: 'margin:4px 0 0;color:var(--text-dim);font-size:14px' },
        j.error ? j.error : (j.activity || j.message || 'Working with the bestselling author…'))));

  const bar = h('div', { class: 'progress-bar' }, h('div', { style: `width:${pct}%` }));

  const list = h('ul', { class: 'chapter-list' });
  if (j.outline.length) {
    j.outline.forEach((c, i) => {
      const done = !!j.chapters[i];
      const active = !done && i === j.activeIndex && working;
      list.append(h('li', { class: done ? 'done' : (active ? 'active' : '') },
        h('span', { class: 'ci' }, done ? '✓' : (active ? '✍️' : '·')),
        h('span', {}, c.title),
        done && j.chapters[i].words ? h('span', { style: 'margin-left:auto;font-size:12px;color:var(--text-dim)' }, `${j.chapters[i].words} w`) : null));
    });
  } else {
    list.append(h('li', { class: 'active' }, h('span', { class: 'ci' }, '✍️'), 'Designing the outline…'));
  }

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
    head, bar,
    h('div', { class: 'card' }, h('p', { class: 'section-title' }, total ? `${doneCount} of ${total} chapters` : 'Preparing'), list),
    actions));
}

// ---------- READER ----------
async function renderReader(id) {
  let book, html;
  try { book = await api.getBook(id); html = await api.getBookHtml(id); }
  catch (err) { toast(`Could not open book: ${err.message}`, 'bad'); return go('library'); }

  const paused = book.status === 'paused';
  const bar = h('div', { class: 'reader-bar' },
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('library') }, '← Library'),
    h('div', { class: 'title' }, book.title),
    h('div', { class: 'spacer' }),
    paused ? h('button', { class: 'btn btn-gold btn-sm', onClick: () => startResume(id) }, '▶ Continue') : null,
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'epub') }, 'EPUB'),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'pdf') }, 'PDF'),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'markdown') }, 'Markdown'),
    h('button', { class: 'btn btn-gold btn-sm', onClick: () => sendKindle(id) }, '📨 Send to Kindle'),
    h('button', { class: 'btn btn-danger btn-sm', onClick: () => deleteBook(id) }, 'Delete'));

  const note = paused && book.pausedReason
    ? h('div', { class: 'pause-note' }, `⏸️ ${book.pausedReason.detail || 'Paused.'} `,
        h('button', { class: 'btn btn-gold btn-sm', onClick: () => startResume(id) }, '▶ Continue writing'))
    : null;

  const frame = h('iframe', { class: 'reader-frame', sandbox: 'allow-same-origin' });
  mount(h('div', { class: 'view reader-view' }, bar, note, frame));
  frame.srcdoc = html;
}

async function doExport(id, format) {
  toast(`Exporting ${format.toUpperCase()}…`);
  try {
    const res = await api.exportBook(id, format, true);
    if (res.canceled) return;
    toast(`Saved ${format.toUpperCase()}. Opening…`, 'ok');
    await api.openPath(res.path);
  } catch (err) { toast(`Export failed: ${err.message}`, 'bad'); }
}
async function sendKindle(id) {
  const k = state.settings && state.settings.kindle;
  if (!k || !k.toAddress || !k.smtp || !k.smtp.host) {
    toast('Set up your Kindle email & SMTP in Settings first.', 'bad');
    return go('settings');
  }
  toast('Building and emailing your book to Kindle…');
  try { await api.sendToKindle(id); toast('📨 Sent! It will appear on your Kindle shortly.', 'ok'); }
  catch (err) { toast(`Send failed: ${err.message}`, 'bad'); }
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
