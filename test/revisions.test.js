'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { REVISION_LIMIT, chapterSnapshot } = require('../src/main/book/revisions');
const { bookToHtml, chapterToHtml } = require('../src/main/export/html');
const { bookToMarkdown } = require('../src/main/export/markdown');
const { audioCachePath } = require('../src/main/book/audioCache');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  store.saveBook({ id: 'book', title: 'The voyage', author: 'Test Author', status: 'complete',
    outline: [{ number: 1, title: 'Departure', summary: 'The voyage starts.' }],
    chapters: [{ number: 1, title: 'Departure', content: '# Departure\n\nOriginal manuscript.', words: 4,
      summary: 'The voyage starts.', artSvg: '<svg></svg>' }] });
  return store;
}

test('legacy books get revision history on first real edit, atomically with their new prose', (t) => {
  const store = fixture(t);
  assert.deepEqual(store.getChapterRevisions('book', 0), { limit: 20, revisions: [] });
  const before = store.getBook('book').chapters[0].content;
  const result = store.updateChapter('book', 0, 'A new manuscript with five words.');
  assert.equal(result.changed, true);
  const history = store.getChapterRevisions('book', 0).revisions;
  assert.equal(history.length, 1);
  assert.equal(history[0].reason, 'manual-edit');
  assert.equal(history[0].characters, before.length);
  assert.equal(history[0].content, undefined, 'listing should not copy every manuscript');
  assert.equal(store.getChapterRevision('book', 0, history[0].id).content, before);
  assert.equal(new Store(store.baseDir).getChapterRevisions('book', 0).revisions.length, 1);
  assert.equal(store.getBook('book').words, 6);
});

test('restore saves current prose for undo and preserves title, summary, outline and artwork', (t) => {
  const store = fixture(t);
  const original = store.getBook('book');
  store.updateChapter('book', 0, 'An alternate ending.');
  const revisionId = store.getChapterRevisions('book', 0).revisions[0].id;
  const modified = store.getBook('book');
  modified.chapters[0].title = 'Current title';
  modified.chapters[0].summary = 'Current summary';
  store.saveBook(modified);
  assert.equal(store.restoreChapterRevision('book', 0, revisionId).changed, true);
  const restored = store.getBook('book');
  assert.equal(restored.chapters[0].content, original.chapters[0].content);
  assert.equal(restored.chapters[0].title, 'Current title');
  assert.equal(restored.chapters[0].summary, 'Current summary');
  assert.equal(restored.chapters[0].artSvg, original.chapters[0].artSvg);
  assert.deepEqual(restored.outline, original.outline);
  const undo = store.getChapterRevisions('book', 0).revisions[0];
  assert.equal(undo.reason, 'restore');
  store.restoreChapterRevision('book', 0, undo.id);
  assert.equal(store.getBook('book').chapters[0].content, modified.chapters[0].content);
});

test('history is bounded and no-op edits or restores leave file and timestamps untouched', (t) => {
  const store = fixture(t);
  for (let i = 1; i <= 24; i++) store.updateChapter('book', 0, `Draft ${i}.`);
  const { revisions } = store.getChapterRevisions('book', 0);
  assert.equal(revisions.length, REVISION_LIMIT);
  assert.equal(new Set(revisions.map((revision) => revision.id)).size, REVISION_LIMIT);
  assert.equal(store.getChapterRevision('book', 0, revisions[0].id).content, 'Draft 23.\n');
  assert.equal(store.getChapterRevision('book', 0, revisions.at(-1).id).content, 'Draft 4.\n');
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  assert.equal(store.updateChapter('book', 0, 'Draft 24.').changed, false);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  store.restoreChapterRevision('book', 0, revisions[0].id);
  const afterRestore = fs.readFileSync(store.bookPath('book'), 'utf8');
  assert.equal(store.restoreChapterRevision('book', 0, revisions[0].id).changed, false);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), afterRestore);
});

test('AI rewrite snapshot contains exact original prose and skips identical results', (t) => {
  const store = fixture(t);
  const book = store.getBook('book');
  const snapshot = chapterSnapshot(book, 0);
  assert.equal(store.saveRewrittenChapter(book, 0, snapshot).changed, false);
  assert.equal(store.getChapterRevisions('book', 0).revisions.length, 0);
  book.chapters[0].content = 'A rewritten chapter.';
  assert.equal(store.saveRewrittenChapter(book, 0, snapshot).changed, true);
  const history = store.getChapterRevisions('book', 0).revisions;
  assert.equal(history[0].reason, 'ai-rewrite');
  assert.equal(store.getChapterRevision('book', 0, history[0].id).content, snapshot.content);
});

test('failed atomic write preserves both current prose and all old revisions', (t) => {
  const store = fixture(t);
  store.updateChapter('book', 0, 'Saved draft.');
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw new Error('Disk write failed'); });
  assert.throws(() => store.updateChapter('book', 0, 'Unsaved draft.'), /Disk write failed/);
  const revision = store.getChapterRevisions('book', 0).revisions[0];
  assert.throws(() => store.restoreChapterRevision('book', 0, revision.id), /Disk write failed/);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(store.booksDir), ['book.json']);
});

test('invalid or foreign book, chapter and revision references cannot mutate a manuscript', (t) => {
  const store = fixture(t);
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  for (const index of [-1, 0.1, '0', null, {}, [], NaN, Infinity, 8]) {
    assert.throws(() => store.updateChapter('book', index, 'Invalid'), /chapter/i);
    assert.throws(() => store.getChapterRevisions('book', index), /chapter/i);
  }
  for (const id of ['../book', 'book/other', '', null, 123, ['book'], { toString: () => 'book' }]) {
    assert.throws(() => store.getChapterRevisions(id, 0), /Invalid book id/);
  }
  for (const id of ['../outside', '', null, {}, '12345678-1234-1234-1234-123456789012']) {
    assert.throws(() => store.restoreChapterRevision('book', 0, id), /revision/i);
  }
  for (const content of [null, {}, [], 123]) assert.throws(() => store.updateChapter('book', 0, content), /text/);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
});

test('corrupt history is preserved instead of silently replaced', (t) => {
  const store = fixture(t);
  const book = store.getBook('book');
  book.chapters[0].revisions = [{ id: '../bad', content: 'Preserve this.' }];
  store.saveBook(book);
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  assert.throws(() => store.getChapterRevisions('book', 0), /preserved/);
  assert.throws(() => store.updateChapter('book', 0, 'New.'), /preserved/);
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
});

test('revision content is excluded from exports and preview uses the shared sanitizer', (t) => {
  const store = fixture(t);
  store.updateChapter('book', 0, 'Current prose.');
  const book = store.getBook('book');
  assert.doesNotMatch(bookToHtml(book), /Original manuscript/);
  assert.doesNotMatch(bookToMarkdown(book), /Original manuscript/);
  const unsafe = '<script>alert(1)</script><p onclick="bad()">Old prose.</p><img src="file:///secret">';
  book.chapters[0].content = unsafe;
  store.saveBook(book);
  store.updateChapter('book', 0, 'Safe current prose.');
  const revision = store.getChapterRevisions('book', 0).revisions[0];
  const html = chapterToHtml(store.getChapterRevision('book', 0, revision.id).content);
  assert.match(html, /Old prose/);
  assert.doesNotMatch(html, /script|onclick|file:/);
});

test('restore uses content-addressed narration cache and removing a book removes its history', (t) => {
  const store = fixture(t);
  const original = store.getBook('book').chapters[0];
  const originalPath = audioCachePath(store.audioDir, original, 'voice', 'model');
  store.updateChapter('book', 0, 'Different spoken text.');
  assert.notEqual(audioCachePath(store.audioDir, store.getBook('book').chapters[0], 'voice', 'model'), originalPath);
  const revision = store.getChapterRevisions('book', 0).revisions[0];
  store.restoreChapterRevision('book', 0, revision.id);
  assert.equal(audioCachePath(store.audioDir, store.getBook('book').chapters[0], 'voice', 'model'), originalPath);
  store.deleteBook('book');
  assert.throws(() => store.getChapterRevisions('book', 0), /ENOENT/);
});

test('startup recovery preserves deliberately short or empty edits and their history', (t) => {
  const store = fixture(t);
  store.updateChapter('book', 0, '');
  const before = fs.readFileSync(store.bookPath('book'), 'utf8');
  const restarted = new Store(store.baseDir);
  restarted.reconcileInterrupted();
  assert.equal(fs.readFileSync(store.bookPath('book'), 'utf8'), before);
  const saved = restarted.getBook('book');
  assert.equal(saved.chapters.length, 1);
  assert.equal(saved.chapters[0].content.trim(), '');
  assert.equal(saved.chapters[0].revisions.length, 1);
  restarted.restoreChapterRevision('book', 0, saved.chapters[0].revisions[0].id);
  assert.match(restarted.getBook('book').chapters[0].content, /Original manuscript/);
});

test('interrupted recovery removes generated stubs while keeping earlier edited chapters', (t) => {
  const store = fixture(t);
  store.updateChapter('book', 0, 'A short intentional chapter.');
  const book = store.getBook('book');
  book.status = 'generating';
  book.chapters.push({ number: 2, title: 'Interrupted', content: '# Interrupted', words: 2 });
  store.saveBook(book);
  store.reconcileInterrupted();
  const recovered = store.getBook('book');
  assert.equal(recovered.status, 'paused');
  assert.equal(recovered.chapters.length, 1);
  assert.match(recovered.chapters[0].content, /intentional/);
  assert.equal(recovered.chapters[0].revisions.length, 1);
});
