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
function mount(node) {
  const root = $('#view-root');
  root.innerHTML = '';
  root.append(node);
}
let toastTimer = null;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4200);
}
function coverGradient(seed) {
  let hash = 0;
  for (let i = 0; i < (seed || 'book').length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(150deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 55% 20%))`;
}
function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
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
  try {
    state.prereq = await api.checkPrerequisites();
  } catch (_) {
    state.prereq = null;
  }
  const pill = $('#provider-pill');
  const banner = $('#prereq-banner');
  const p = state.prereq;
  const provider = (state.settings && state.settings.provider) || 'claude';
  const active = p ? p[provider] : null;

  if (active && active.found) {
    pill.className = 'pill ok';
    pill.textContent = `● ${provider === 'codex' ? 'Codex' : 'Claude'} ready`;
    banner.classList.add('hidden');
  } else {
    pill.className = 'pill bad';
    pill.textContent = `● ${provider === 'codex' ? 'Codex' : 'Claude'} not found`;
    const cmd = provider === 'codex' ? 'codex' : 'claude';
    banner.innerHTML = '';
    banner.append(
      h('span', {}, `⚠️ The ${cmd} CLI was not found. Install and sign in to it, then re-check.`),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheck() }, 'Re-check'),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('settings') }, 'Settings')
    );
    banner.classList.remove('hidden');
  }
}
async function recheck() {
  await refreshPrereq();
  if (state.view === 'create') renderCreate();
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
      const card = h('div', { class: 'book-card', onClick: () => go('reader', b.id) },
        h('div', { class: 'book-cover', style: `background:${coverGradient(b.title)}` },
          h('h3', {}, b.title || 'Untitled'),
          h('div', { class: 'by' }, `by ${b.author || 'Anonymous'}`)),
        h('div', { class: 'book-meta' },
          h('div', { class: 'stat' },
            h('span', { class: `badge ${b.status}` }, b.status === 'generating' ? 'Writing…' : (b.status || 'draft')),
            h('span', {}, b.genre || '')),
          h('div', { class: 'stat', style: 'margin-top:8px' },
            h('span', {}, `${b.chapters}/${b.plannedChapters || b.chapters} ch`),
            h('span', {}, `${(b.words || 0).toLocaleString()} words`))));
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
function selectEl(id, options, selected) {
  const s = h('select', { id });
  for (const o of options) s.append(h('option', { value: o, selected: o === selected ? 'selected' : false }, o));
  return s;
}
function readSpec() {
  return {
    request: $('#f-request').value.trim(),
    genre: $('#f-genre').value.trim(),
    audience: $('#f-audience').value.trim(),
    length: $('#f-length').value,
    tone: $('#f-tone').value.trim(),
    pov: $('#f-pov').value.trim(),
    notes: $('#f-notes').value.trim(),
  };
}

function renderCreate() {
  const provider = (state.settings && state.settings.provider) || 'claude';
  const ready = state.prereq && state.prereq[provider] && state.prereq[provider].found;
  const head = h('div', { class: 'page-head' },
    h('h1', {}, 'Commission a new book'),
    h('p', {}, 'Tell the bestselling author what you want. Vague is fine — they’ll ask smart questions before writing.'));

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', id: 'btn-clarify', onClick: onClarify },
      ready ? 'Continue →' : 'CLI not ready'),
    h('button', { class: 'btn btn-ghost', onClick: () => skipToGenerate() }, 'Skip questions & write now'));

  const node = h('div', { class: 'view' }, head, specForm(state.draftSpec || {}), actions);
  mount(node);
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
    if (state.clarify.needsClarification && state.clarify.questions.length) {
      go('clarify');
    } else {
      startGeneration(spec, {});
    }
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
      q.suggestions.forEach((s) =>
        chips.append(h('button', { class: 'chip', onClick: () => { $('#' + inputId).value = s; } }, s)));
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

// ---------- GENERATION ----------
function startGeneration(spec, answers) {
  const jobId = `job-${Date.now()}`;
  state.job = { jobId, spec, answers, phase: 'starting', chapters: [], outline: [], title: spec.request.slice(0, 40), bookId: null, error: null, done: false };
  go('progress');

  const off = api.onProgress((e) => {
    if (e.jobId !== jobId) return;
    handleProgress(e);
  });
  state.job.off = off;

  api.generate(spec, answers, jobId)
    .then((res) => {
      state.job.bookId = res.id;
      state.job.done = true;
      if (state.view === 'progress') renderProgress();
      toast('🎉 Your book is ready!', 'ok');
    })
    .catch((err) => {
      state.job.error = err.message;
      if (state.view === 'progress') renderProgress();
      toast(`Generation stopped: ${err.message}`, 'bad');
    })
    .finally(() => { if (off) off(); });
}

function handleProgress(e) {
  const j = state.job;
  if (!j) return;
  j.phase = e.phase;
  if (e.phase === 'outline:done') {
    j.title = e.title;
    j.outline = (e.book && e.book.outline) || [];
    j.bookId = e.book && e.book.id;
  }
  if (e.phase === 'chapter:start') j.activeIndex = e.index;
  if (e.phase === 'chapter:done') {
    j.chapters[e.index] = { number: e.number, title: e.title, words: e.words };
    j.activeIndex = e.index + 1;
  }
  if (e.message) j.message = e.message;
  if (state.view === 'progress') renderProgress();
}

function renderProgress() {
  const j = state.job;
  if (!j) return go('library');
  const total = j.outline.length || (j.spec ? 0 : 0);
  const doneCount = j.chapters.filter(Boolean).length;
  const pct = total ? Math.round((doneCount / total) * 100) : (j.phase === 'outline:start' ? 6 : 12);

  const head = h('div', { class: 'progress-head' },
    j.done || j.error ? h('div', {}, j.error ? '⚠️' : '✅') : h('div', { class: 'spinner' }),
    h('div', {},
      h('h1', { style: 'margin:0;font-size:22px' }, j.done ? j.title : (j.error ? 'Generation interrupted' : 'Writing your book…')),
      h('p', { style: 'margin:4px 0 0;color:var(--text-dim);font-size:14px' },
        j.error ? j.error : (j.message || 'Working with the bestselling author…'))));

  const bar = h('div', { class: 'progress-bar' }, h('div', { style: `width:${pct}%` }));

  const list = h('ul', { class: 'chapter-list' });
  if (j.outline.length) {
    j.outline.forEach((c, i) => {
      const done = !!j.chapters[i];
      const active = !done && i === j.activeIndex && !j.done && !j.error;
      list.append(h('li', { class: done ? 'done' : (active ? 'active' : '') },
        h('span', { class: 'ci' }, done ? '✓' : (active ? '✍️' : '·')),
        h('span', {}, `${c.title}`),
        done ? h('span', { style: 'margin-left:auto;font-size:12px;color:var(--text-dim)' }, `${j.chapters[i].words} w`) : null));
    });
  } else {
    list.append(h('li', { class: 'active' }, h('span', { class: 'ci' }, '✍️'), 'Designing the outline…'));
  }

  const actions = h('div', { class: 'btn-row', style: 'margin-top:22px' });
  if (j.done && j.bookId) {
    actions.append(h('button', { class: 'btn btn-gold', onClick: () => go('reader', j.bookId) }, '📖 Read it now'));
  } else if (j.error) {
    actions.append(
      h('button', { class: 'btn btn-ghost', onClick: () => go('create') }, '← Edit & retry'),
      j.bookId ? h('button', { class: 'btn btn-ghost', onClick: () => go('reader', j.bookId) }, 'Open partial draft') : null);
  } else {
    actions.append(h('button', { class: 'btn btn-danger', onClick: async () => {
      await api.cancelGeneration(j.jobId); toast('Cancelling…');
    } }, 'Cancel'));
  }

  mount(h('div', { class: 'view' },
    head, bar,
    h('div', { class: 'card' }, h('p', { class: 'section-title' }, total ? `${doneCount} of ${total} chapters` : 'Preparing'), list),
    actions));
}

// ---------- READER ----------
async function renderReader(id) {
  let book, html;
  try {
    book = await api.getBook(id);
    html = await api.getBookHtml(id);
  } catch (err) {
    toast(`Could not open book: ${err.message}`, 'bad');
    return go('library');
  }

  const bar = h('div', { class: 'reader-bar' },
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => go('library') }, '← Library'),
    h('div', { class: 'title' }, book.title),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'epub') }, 'EPUB'),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'pdf') }, 'PDF'),
    h('button', { class: 'btn btn-ghost btn-sm', onClick: () => doExport(id, 'markdown') }, 'Markdown'),
    h('button', { class: 'btn btn-gold btn-sm', onClick: () => sendKindle(id) }, '📨 Send to Kindle'),
    h('button', { class: 'btn btn-danger btn-sm', onClick: () => deleteBook(id) }, 'Delete'));

  const frame = h('iframe', { class: 'reader-frame', sandbox: 'allow-same-origin' });
  const node = h('div', { class: 'view reader-view' }, bar, frame);
  mount(node);
  frame.srcdoc = html;
}

async function doExport(id, format) {
  toast(`Exporting ${format.toUpperCase()}…`);
  try {
    const res = await api.exportBook(id, format, true);
    if (res.canceled) return;
    toast(`Saved ${format.toUpperCase()}. Opening…`, 'ok');
    await api.openPath(res.path);
  } catch (err) {
    toast(`Export failed: ${err.message}`, 'bad');
  }
}

async function sendKindle(id) {
  const s = state.settings;
  const k = s && s.kindle;
  if (!k || !k.toAddress || !k.smtp || !k.smtp.host) {
    toast('Set up your Kindle email & SMTP in Settings first.', 'bad');
    return go('settings');
  }
  toast('Building and emailing your book to Kindle…');
  try {
    await api.sendToKindle(id);
    toast('📨 Sent! It will appear on your Kindle shortly.', 'ok');
  } catch (err) {
    toast(`Send failed: ${err.message}`, 'bad');
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
    h('p', {}, 'Choose your AI engine and configure Kindle delivery.'));

  // provider segment
  const seg = h('div', { class: 'seg' },
    h('button', { class: s.provider === 'claude' ? 'active' : '', onClick: () => { s.provider = 'claude'; saveAndRerender(); } }, 'Claude Code'),
    h('button', { class: s.provider === 'codex' ? 'active' : '', onClick: () => { s.provider = 'codex'; saveAndRerender(); } }, 'Codex'));

  const statusRow = (key, label) => {
    const info = p[key];
    const ok = info && info.found;
    return h('div', { class: 'kv' },
      h('span', { class: 'k' },
        h('span', { class: `status-dot ${ok ? 'ok' : 'bad'}` }), label),
      h('span', {}, ok ? (info.version || 'found') : 'not found'));
  };

  const engineCard = h('div', { class: 'card' },
    h('p', { class: 'section-title' }, 'AI engine'),
    h('p', { class: 'hint', style: 'margin-bottom:14px' }, 'BookWriter drives your locally installed CLI and uses your own subscription. Nothing is sent to any third-party server.'),
    h('div', { style: 'margin-bottom:16px' }, seg),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Claude command'),
        h('input', { id: 's-claude-cmd', value: s.claudeCommand || 'claude' })),
      h('label', { class: 'field' }, h('span', {}, 'Claude model (blank = default)'),
        h('input', { id: 's-claude-model', value: s.claudeModel || '', placeholder: 'e.g. claude-sonnet-4-6' }))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, h('span', {}, 'Codex command'),
        h('input', { id: 's-codex-cmd', value: s.codexCommand || 'codex' })),
      h('label', { class: 'field' }, h('span', {}, 'Codex model (blank = default)'),
        h('input', { id: 's-codex-model', value: s.codexModel || '' }))),
    statusRow('claude', 'Claude Code CLI'),
    statusRow('codex', 'Codex CLI'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => recheck().then(renderSettings) }, 'Re-check CLIs'),
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

async function saveAndRerender() {
  state.settings = await api.saveSettings({ provider: state.settings.provider });
  await refreshPrereq();
  renderSettings();
}
async function persistEngineFields() {
  state.settings = await api.saveSettings({
    provider: state.settings.provider,
    claudeCommand: $('#s-claude-cmd').value.trim() || 'claude',
    claudeModel: $('#s-claude-model').value.trim(),
    codexCommand: $('#s-codex-cmd').value.trim() || 'codex',
    codexModel: $('#s-codex-model').value.trim(),
  });
}
async function testAuth() {
  await persistEngineFields();
  const btn = $('#btn-auth');
  btn.textContent = 'Testing…'; btn.setAttribute('disabled', 'true');
  try {
    const res = await api.checkAuth();
    toast(res.ok ? '✅ Connected and authenticated.' : `Not authenticated: ${res.detail}`, res.ok ? 'ok' : 'bad');
  } catch (err) {
    toast(`Test failed: ${err.message}`, 'bad');
  } finally {
    btn.textContent = 'Test connection'; btn.removeAttribute('disabled');
  }
}
async function saveKindle() {
  await persistEngineFields();
  state.settings = await api.saveSettings({
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
  try {
    await api.verifyKindle();
    toast('✅ SMTP connection works.', 'ok');
  } catch (err) {
    toast(`SMTP check failed: ${err.message}`, 'bad');
  }
}

// ---------- bootstrap ----------
document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.view)));

if (api.onMenu) {
  api.onMenu((action) => {
    if (action === 'new-book') go('create');
    if (action === 'settings') go('settings');
  });
}

(async function init() {
  try {
    state.settings = await api.getSettings();
  } catch (_) {
    state.settings = { provider: 'claude' };
  }
  await refreshPrereq();
  go('library');
})();
})();
