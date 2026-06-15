'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, deepMerge } = require('../src/main/store');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-store-'));
  return new Store(dir);
}

test('default settings shape', () => {
  const s = tmpStore();
  const d = s.getSettings();
  assert.strictEqual(d.provider, 'claude');
  assert.ok(d.kindle && d.kindle.smtp);
});

test('save and merge settings', () => {
  const s = tmpStore();
  s.saveSettings({ provider: 'codex', kindle: { toAddress: 'x@kindle.com' } });
  const out = s.getSettings();
  assert.strictEqual(out.provider, 'codex');
  assert.strictEqual(out.kindle.toAddress, 'x@kindle.com');
  // unspecified nested defaults preserved
  assert.strictEqual(out.kindle.smtp.port, 587);
});

test('book CRUD + list', () => {
  const s = tmpStore();
  const book = {
    id: 'abc', title: 'Test Book', author: 'A', status: 'complete',
    outline: [{ number: 1 }], chapters: [{ number: 1, words: 10, content: '# x' }],
  };
  s.saveBook(book);
  const got = s.getBook('abc');
  assert.strictEqual(got.title, 'Test Book');
  const list = s.listBooks();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].words, 10);
  s.deleteBook('abc');
  assert.strictEqual(s.listBooks().length, 0);
});

test('clearAllData wipes books, media, exports and settings but keeps the app usable', () => {
  const s = tmpStore();
  s.saveSettings({ audio: { elevenApiKey: 'secret' } });
  s.saveBook({ id: 'b1', title: 'One', chapters: [] });
  s.saveBook({ id: 'b2', title: 'Two', chapters: [] });
  fs.writeFileSync(path.join(s.imagesDir, 'cover.png'), 'x');
  fs.writeFileSync(path.join(s.audioDir, 'ch1.mp3'), 'x');
  fs.writeFileSync(path.join(s.exportsDir, 'book.epub'), 'x');

  const summary = s.clearAllData();
  assert.equal(summary.books, 2);
  assert.equal(summary.settings, true);

  // Everything gone…
  assert.equal(s.listBooks().length, 0);
  assert.equal(fs.readdirSync(s.imagesDir).length, 0);
  assert.equal(fs.readdirSync(s.audioDir).length, 0);
  assert.equal(fs.readdirSync(s.exportsDir).length, 0);
  // …settings back to defaults (api key cleared)…
  assert.equal(s.getSettings().audio.elevenApiKey, '');
  // …and the store still works (folders recreated, can save again).
  s.saveBook({ id: 'b3', title: 'Fresh', chapters: [] });
  assert.equal(s.listBooks().length, 1);
});

test('deepMerge does not mutate arrays into objects', () => {
  const out = deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3], b: { d: 2 } });
  assert.deepStrictEqual(out.a, [3]);
  assert.deepStrictEqual(out.b, { c: 1, d: 2 });
});

test('reconcileInterrupted flips stale generating books to paused/resumable', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const { Store } = require('../src/main/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-rec-'));
  const s = new Store(dir);
  s.saveBook({ id: 'g1', status: 'generating', title: 'Stuck', chapters: [{ number: 1 }], outline: [{ number: 1 }, { number: 2 }] });
  s.saveBook({ id: 'c1', status: 'complete', title: 'Done', chapters: [], outline: [] });
  s.reconcileInterrupted();
  assert.strictEqual(s.getBook('g1').status, 'paused');
  assert.strictEqual(s.getBook('g1').pausedReason.resumable, true);
  assert.strictEqual(s.getBook('c1').status, 'complete'); // untouched
});

test('reconcileInterrupted rescues a complete book that has a stub chapter', () => {
  const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
  const { Store } = require('../src/main/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'co-stub-'));
  const s = new Store(dir);
  s.saveBook({ id: 'b', status: 'complete', title: 'X', outline: [{ number: 1 }, { number: 2 }],
    chapters: [{ number: 1, title: 'A', content: 'x'.repeat(900), words: 1400 }, { number: 2, title: 'B', content: '# B', words: 7 }] });
  s.reconcileInterrupted();
  const b = s.getBook('b');
  assert.strictEqual(b.status, 'paused');
  assert.strictEqual(b.chapters.length, 1); // stub dropped so resume rewrites ch2
});
