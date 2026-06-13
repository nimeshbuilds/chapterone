'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  bestsellerPersona,
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  targetWordsForLength,
} = require('../src/main/book/prompts');

test('persona names the genre and bestseller framing', () => {
  const p = bestsellerPersona('Science Fiction');
  assert.match(p, /bestselling/i);
  assert.match(p, /Science Fiction/);
});

test('clarify prompt asks for JSON and includes the request', () => {
  const p = clarifyPrompt({ request: 'a space opera' });
  assert.match(p, /a space opera/);
  assert.match(p, /needsClarification/);
  assert.match(p, /JSON/);
});

test('outline prompt folds in reader answers', () => {
  const p = outlinePrompt({ request: 'mystery', length: 'short' }, { tone: 'dark' });
  assert.match(p, /READER CLARIFICATIONS/);
  assert.match(p, /tone: dark/);
  assert.match(p, /chapters/);
});

test('chapter prompt enforces style guide and continuity', () => {
  const book = { title: 'X', genre: 'Mystery', audience: 'adults', premise: 'p', themes: ['a'], styleGuide: 'tense' };
  const ch = { number: 2, title: 'The Turn', beats: ['b1', 'b2'], summary: 's' };
  const p = chapterPrompt(book, ch, 'previously...', 2400);
  assert.match(p, /CHAPTER 2/);
  assert.match(p, /The Turn/);
  assert.match(p, /previously\.\.\./);
  assert.match(p, /2400 words/);
});

test('chapter prompt adds research and image instructions when flagged', () => {
  const book = { title: 'X', genre: 'History', audience: 'adults', premise: 'p', themes: [], styleGuide: 's' };
  const ch = { number: 1, title: 'A', beats: [], summary: 's' };
  const plain = chapterPrompt(book, ch, '', 2000, {});
  assert.doesNotMatch(plain, /web search available/i);
  const rich = chapterPrompt(book, ch, '', 2000, { research: true, illustrate: true });
  assert.match(rich, /web search available/i);
  assert.match(rich, /image-search:/);
  assert.match(rich, /high-resolution|stock photo|premium quality/i);
});

test('edit prompt asks for a bestseller revision and preserves image lines', () => {
  const { editPrompt } = require('../src/main/book/prompts');
  const book = { genre: 'Thriller', premise: 'p', styleGuide: 'tense' };
  const ch = { number: 3, title: 'The Trap' };
  const p = editPrompt(book, ch, '# The Trap\n\nDraft text.', { research: true });
  assert.match(p, /developmental editor/i);
  assert.match(p, /# The Trap/);
  assert.match(p, /Draft text\./);
  assert.match(p, /image-search/); // instructs preserving image markers
  assert.match(p, /web search/i); // research-aware
});

test('word targets scale with size', () => {
  assert.ok(targetWordsForLength('short novella') < targetWordsForLength('standard'));
  assert.ok(targetWordsForLength('epic long') > targetWordsForLength('standard'));
});

test('book sizes map to page ranges and chapter plans', () => {
  const { sizeOf, chapterHintForSize, SIZES } = require('../src/main/book/prompts');
  assert.strictEqual(sizeOf({ size: 'small' }).key, 'small');
  assert.strictEqual(sizeOf({ size: 'large' }).key, 'large');
  assert.strictEqual(sizeOf({}).key, 'medium'); // default
  assert.match(chapterHintForSize({ size: 'small' }), /35–60 pages/);
  assert.match(chapterHintForSize({ size: 'large' }), /150–250 pages/);
  assert.ok(SIZES.small.words < SIZES.large.words);
});

test('cover and chapter-art prompts request a single SVG', () => {
  const { coverSvgPrompt, chapterArtSvgPrompt } = require('../src/main/book/prompts');
  const book = { title: 'Tide', author: 'X', genre: 'Mystery', themes: ['sea'], premise: 'p' };
  const cover = coverSvgPrompt(book);
  assert.match(cover, /SVG/);
  assert.match(cover, /Tide/);
  assert.match(cover, /viewBox/);
  const art = chapterArtSvgPrompt(book, { number: 2, title: 'Deep', summary: 's' });
  assert.match(art, /viewBox/);
  assert.match(art, /NO <script>|no <script>|NO <script/i);
});
