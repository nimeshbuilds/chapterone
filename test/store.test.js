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

test('deepMerge does not mutate arrays into objects', () => {
  const out = deepMerge({ a: [1, 2], b: { c: 1 } }, { a: [3], b: { d: 2 } });
  assert.deepStrictEqual(out.a, [3]);
  assert.deepStrictEqual(out.b, { c: 1, d: 2 });
});
