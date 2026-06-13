'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateEpub, toXhtml } = require('../src/main/export/epub');
const { bookToMarkdown } = require('../src/main/export/markdown');
const { bookToHtml, chapterToHtml } = require('../src/main/export/html');

const sampleBook = {
  id: 'b1',
  title: 'The Midnight Bakery',
  subtitle: 'A Cozy Mystery',
  author: 'Jane Quill',
  genre: 'Mystery',
  premise: 'A baker solves crimes.',
  themes: ['community', 'secrets'],
  chapters: [
    { number: 1, title: 'Flour & Fear', content: '# Flour & Fear\n\nThe oven was *cold*.\n\nShe knew **someone** had been here.' },
    { number: 2, title: 'Rising Dough', content: '# Rising Dough\n\nMorning came.\n\n---\n\nThe end of part one.' },
  ],
};

test('toXhtml self-closes void elements', () => {
  assert.match(toXhtml('<hr><br>'), /<hr \/>|<hr\/>/);
  assert.match(toXhtml('<br>'), /<br \/>/);
});

test('chapterToHtml converts markdown emphasis', () => {
  const html = chapterToHtml('Hello *world* and **bold**');
  assert.match(html, /<em>world<\/em>/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test('bookToMarkdown includes title and chapters', () => {
  const md = bookToMarkdown(sampleBook);
  assert.match(md, /# The Midnight Bakery/);
  assert.match(md, /Flour & Fear/);
  assert.match(md, /Rising Dough/);
});

test('bookToHtml builds a full document with title page', () => {
  const html = bookToHtml(sampleBook);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /The Midnight Bakery/);
  assert.match(html, /Jane Quill/);
  assert.match(html, /class="chapter"/);
});

test('generateEpub writes a valid zip with required entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-epub-'));
  const out = path.join(dir, 'book.epub');
  await generateEpub(sampleBook, out);
  const buf = fs.readFileSync(out);
  assert.ok(buf.length > 200, 'epub should be non-trivial');
  // ZIP local file header magic
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
  // mimetype must be the first entry and stored uncompressed right after header
  const head = buf.slice(0, 80).toString('latin1');
  assert.match(head, /mimetypeapplication\/epub\+zip/);
  // required files present somewhere in the archive
  const whole = buf.toString('latin1');
  for (const name of ['container.xml', 'content.opf', 'nav.xhtml', 'toc.ncx', 'chapter-1.xhtml', 'chapter-2.xhtml']) {
    assert.ok(whole.includes(name), `epub should contain ${name}`);
  }
});

test('chapterToHtml prefixes the heading with the chapter number', () => {
  const { chapterToHtml } = require('../src/main/export/html');
  assert.match(chapterToHtml('# A Title\n\nText.', null, 4), /Chapter 4: A Title/);
  // does not double-number a heading that already says "Chapter"
  assert.doesNotMatch(chapterToHtml('# Chapter 2: Done\n\nx', null, 2), /Chapter 2: Chapter 2/);
  // no number arg -> unchanged
  assert.doesNotMatch(chapterToHtml('# Plain\n\nx', null), /Chapter/);
});
