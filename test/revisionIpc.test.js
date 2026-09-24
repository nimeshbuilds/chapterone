'use strict';

// Unit-level IPC orchestration checks. Electron UI/preload isolation is covered
// separately by the native smoke suite; these doubles only control long jobs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { Store } = require('../src/main/store');
const { UI_URL } = require('../src/main/security');
const cli = require('../src/main/cli');
const elevenlabs = require('../src/main/book/elevenlabs');

const handlers = new Map();
let engineFactory;
const dialog = { showSaveDialog: async () => ({ canceled: true }) };
const electron = { ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog,
  BrowserWindow: { getFocusedWindow: () => null }, shell: {} };
const originalLoad = Module._load;
let registerIpc;
try {
  Module._load = function (name, parent, isMain) {
    if (name === 'electron') return electron;
    if (name === './cli' && parent.filename.endsWith(path.join('main', 'ipc.js'))) {
      return { ...cli, createChainEngine: (...args) => engineFactory(...args) };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
  ({ registerIpc } = require('../src/main/ipc'));
} finally {
  Module._load = originalLoad;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-revision-ipc-'));
  const store = new Store(dir);
  store.saveBook({ id: 'book', title: 'Voyage', author: 'Test Author', status: 'complete',
    outline: [{ number: 1, title: 'Departure', summary: 'A voyage starts.' }],
    chapters: [{ number: 1, title: 'Departure', content: '# Departure\n\nOriginal prose.', words: 4 }] });
  store.updateChapter('book', 0, '# Departure\n\nThe current prose.');
  const revisionId = store.getChapterRevisions('book', 0).revisions[0].id;
  handlers.clear();
  engineFactory = () => ({ complete: async () => '# Departure\n\nThe rewritten prose.' });
  const ipc = registerIpc(store);
  t.after(() => { ipc.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  const frame = { url: UI_URL };
  const event = { senderFrame: frame, sender: { mainFrame: frame, isDestroyed: () => false, send: () => {} } };
  const call = (channel, data, sender = event) => handlers.get(channel)(sender, data);
  return { store, call, revisionId, event };
}

test('revision and readiness IPC reject untrusted frames and preview sanitized prose', async (t) => {
  const { store, call, revisionId, event } = fixture(t);
  const wrongEvent = { ...event, senderFrame: { url: UI_URL } };
  for (const [channel, payload] of [
    ['book:revisions', { id: 'book', index: 0 }],
    ['book:revision', { id: 'book', index: 0, revisionId }],
    ['book:restoreRevision', { id: 'book', index: 0, revisionId }],
    ['book:readiness', 'book'],
  ]) {
    const denied = await call(channel, payload, wrongEvent);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /Untrusted IPC/);
  }
  const book = store.getBook('book');
  book.chapters[0].revisions[0].content = '<script>bad()</script><p onclick="bad()">Saved prose</p><img src="https://example.test/pixel">';
  store.saveBook(book);
  const preview = await call('book:revision', { id: 'book', index: 0, revisionId });
  assert.equal(preview.ok, true);
  assert.match(preview.data.html, /Saved prose/);
  assert.doesNotMatch(preview.data.html, /script|onclick|example.test/);
  const report = await call('book:readiness', 'book');
  assert.equal(report.ok, true);
  assert.equal(report.data.status, 'clear');
});

test('manuscript changes are blocked throughout an export dialog and work after it closes', async (t) => {
  const { store, call, revisionId } = fixture(t);
  const entered = deferred();
  const finish = deferred();
  t.mock.method(dialog, 'showSaveDialog', () => { entered.resolve(); return finish.promise; });
  const exporting = call('book:export', { id: 'book', format: 'markdown', saveAs: true });
  await entered.promise;
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  for (const [channel, payload] of [
    ['book:updateChapter', { id: 'book', index: 0, content: 'Do not save.' }],
    ['book:restoreRevision', { id: 'book', index: 0, revisionId }],
    ['book:update', { id: 'book', title: 'Do not rename.' }],
    ['book:rewriteChapter', { id: 'book', index: 0, jobId: 'blocked-rewrite' }],
    ['book:resume', { id: 'book', jobId: 'blocked-resume' }],
    ['book:generate', { spec: {}, jobId: 'blocked-generation' }],
  ]) {
    const result = await call(channel, payload);
    assert.equal(result.ok, false, channel);
    assert.match(result.error, /audio, export, or delivery/);
  }
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  finish.resolve({ canceled: true });
  assert.equal((await exporting).ok, true);
  assert.equal((await call('book:restoreRevision', { id: 'book', index: 0, revisionId })).ok, true);
});

test('restore waits for narration to finish and then selects the restored text cache', async (t) => {
  const { store, call, revisionId } = fixture(t);
  store.saveSettings({ audio: { voiceId: 'test-voice', elevenApiKey: 'offline-fixture' } });
  const entered = deferred();
  const finish = deferred();
  t.mock.method(elevenlabs, 'tts', () => { entered.resolve(); return finish.promise; });
  const audio = call('audio:synth', { id: 'book', index: 0 });
  await entered.promise;
  const blocked = await call('book:restoreRevision', { id: 'book', index: 0, revisionId });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /audio/);
  finish.resolve({ buffer: Buffer.from('Synthetic audio fixture') });
  assert.equal((await audio).ok, true);
  assert.equal((await call('book:restoreRevision', { id: 'book', index: 0, revisionId })).ok, true);
  const status = await call('audio:status', { id: 'book' });
  assert.equal(status.ok, true);
  assert.equal(status.data.have, 0, 'the previous spoken text must not be reused for restored text');
});

test('cancelled rewrites cannot save even when a provider returns after cancellation', async (t) => {
  const { store, call, revisionId } = fixture(t);
  const entered = deferred();
  const finish = deferred();
  engineFactory = () => ({ complete: () => { entered.resolve(); return finish.promise; } });
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  const rewriting = call('book:rewriteChapter', { id: 'book', index: 0, jobId: 'cancelled-rewrite' });
  await entered.promise;
  for (const [channel, payload] of [
    ['book:updateChapter', { id: 'book', index: 0, content: 'Blocked prose.' }],
    ['book:restoreRevision', { id: 'book', index: 0, revisionId }],
  ]) {
    const blocked = await call(channel, payload);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /current writing job/);
  }
  assert.equal((await call('book:cancel', 'cancelled-rewrite')).data.cancelled, true);
  finish.resolve('# Departure\n\nA late response must not overwrite the manuscript.');
  const result = await rewriting;
  assert.equal(result.ok, false);
  assert.match(result.error, /cancelled/);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  assert.equal((await call('book:restoreRevision', { id: 'book', index: 0, revisionId })).ok, true);
});

test('failed provider setup and failed rewrites release the writing slot without recording history', async (t) => {
  const { store, call } = fixture(t);
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  for (const factory of [
    () => { throw new Error('Provider configuration failed'); },
    () => ({ complete: async () => { throw new Error('Provider unavailable'); } }),
  ]) {
    engineFactory = factory;
    const result = await call('book:rewriteChapter', { id: 'book', index: 0, jobId: 'failed-rewrite' });
    assert.equal(result.ok, false);
    assert.match(result.error, /Provider/);
    assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  }
  const edit = await call('book:updateChapter', { id: 'book', index: 0, content: 'Recovered draft.' });
  assert.equal(edit.ok, true);
  assert.equal(store.getChapterRevisions('book', 0).revisions.length, 2);
});

test('successful rewrite keeps the original version and validates input before provider invocation', async (t) => {
  const { store, call } = fixture(t);
  let calls = 0;
  engineFactory = () => ({ complete: async () => { calls++; return '# Departure\n\nA better ending.'; } });
  const before = store.getBook('book').chapters[0].content;
  const invalid = await call('book:rewriteChapter', { id: 'book', index: '0', jobId: 'invalid' });
  assert.equal(invalid.ok, false);
  assert.equal(calls, 0);
  const result = await call('book:rewriteChapter', { id: 'book', index: 0, jobId: 'success' });
  assert.equal(result.ok, true);
  assert.equal(result.data.changed, true);
  assert.equal(calls, 1);
  const revision = store.getChapterRevisions('book', 0).revisions[0];
  assert.equal(revision.reason, 'ai-rewrite');
  assert.equal(store.getChapterRevision('book', 0, revision.id).content, before);
});

for (const [channel, payload] of [
  ['book:generate', { spec: { request: 'A river voyage', imageMode: 'off', research: false, polish: false } }],
  ['book:resume', { id: 'book' }],
]) {
  test(`${channel} releases its writing slot after provider setup fails, allowing edits and a successful retry`, async (t) => {
    const { store, call } = fixture(t);
    const before = fs.readFileSync(store.bookPath('book'), 'utf8');
    engineFactory = () => { throw new Error('Invalid provider configuration'); };
    const failed = await call(channel, { ...payload, jobId: 'setup-failure' });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /Invalid provider configuration/);
    assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
    assert.equal((await call('book:cancel', 'setup-failure')).data.cancelled, false);
    assert.equal((await call('book:updateChapter', { id: 'book', index: 0, content: 'An edited draft after configuration failed.' })).ok, true);
    engineFactory = () => ({ id: 'offline-fixture', complete: async (prompt) => {
      if (/market-ready book/.test(prompt)) return JSON.stringify({ title: 'Retry book', author: 'Test Author',
        chapters: [{ title: 'Opening', summary: 'A safe voyage.' }] });
      if (/WRITE CHAPTER/.test(prompt)) return '# Opening\n\n' + 'The quiet river carried the boat home. '.repeat(40);
      return '{}';
    } });
    const retry = await call(channel, { ...payload, jobId: 'setup-retry' });
    assert.equal(retry.ok, true, retry.error);
    assert.equal(store.getBook(retry.data.id).status, 'complete');
    assert.equal((await call('book:cancel', 'setup-retry')).data.cancelled, false);
  });
}
