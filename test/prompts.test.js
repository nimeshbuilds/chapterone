'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  bestsellerPersona,
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  stockQueryPrompt,
  targetWordsForLength,
} = require('../src/main/book/prompts');

test('stockQueryPrompt asks for one concrete query or NONE and includes chapter context', () => {
  const p = stockQueryPrompt(
    { title: 'The Hypervisor Labyrinth', premise: 'A thriller in a data center' },
    { title: 'The Cold Aisle' },
    '# The Cold Aisle\n\nRows of servers hummed in the freezing dark. ![x](image-search: ignore me)',
  );
  assert.match(p, /The Cold Aisle/);          // chapter title present
  assert.match(p, /Hypervisor Labyrinth/);    // book title present
  assert.match(p, /\bNONE\b/);                // explicit opt-out
  assert.match(p, /3 to 7/);                  // bounded query length
  assert.doesNotMatch(p, /image-search: ignore me/); // existing markers stripped from the excerpt
});

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

test('kindOf normalizes fiction / non-fiction', () => {
  const { kindOf } = require('../src/main/book/prompts');
  assert.strictEqual(kindOf({ kind: 'fiction' }), 'fiction');
  assert.strictEqual(kindOf({ kind: 'Non-fiction' }), 'nonfiction');
  assert.strictEqual(kindOf({ kind: 'nonfiction' }), 'nonfiction');
  assert.strictEqual(kindOf({ kind: '' }), ''); // let the author decide
  assert.strictEqual(kindOf({}), '');
});

test('outline prompt carries the chosen category', () => {
  const { outlinePrompt } = require('../src/main/book/prompts');
  assert.match(outlinePrompt({ request: 'x', kind: 'fiction' }, {}), /FICTION/);
  assert.match(outlinePrompt({ request: 'x', kind: 'nonfiction' }, {}), /NON-FICTION/);
  assert.match(outlinePrompt({ request: 'x' }, {}), /you choose fiction or non-fiction/);
});

test('chapter prompt states the category when set', () => {
  const { chapterPrompt } = require('../src/main/book/prompts');
  const book = { title: 'T', genre: 'Mystery', audience: 'A', premise: 'p', themes: [], kind: 'fiction' };
  assert.match(chapterPrompt(book, { number: 1, title: 'C', beats: [], summary: 's' }, '', 1500, {}), /FICTION/);
});

test('masters prompt asks for five authors and a blueprint as JSON', () => {
  const { mastersPrompt } = require('../src/main/book/prompts');
  const p = mastersPrompt({ request: 'a heist novel', genre: 'Thriller', kind: 'fiction' });
  assert.match(p, /FIVE most acclaimed/i);
  assert.match(p, /blueprint/i);
  assert.match(p, /"authors"/);
});

test('influence directive injects the surpass mandate, or nothing when absent', () => {
  const { influenceDirective } = require('../src/main/book/prompts');
  const inf = { authors: [{ name: 'A. Writer', signature: 'tight plotting' }], blueprint: 'combine and exceed' };
  const d = influenceDirective(inf);
  assert.match(d, /A\. Writer/);
  assert.match(d, /BETTER than any of these authors/i);
  assert.strictEqual(influenceDirective(null), '');
  assert.strictEqual(influenceDirective({ authors: [] }), '');
});

test('charactersBlock and kidsDirective shape the prompts', () => {
  const { charactersBlock, kidsDirective, outlinePrompt, chapterPrompt } = require('../src/main/book/prompts');
  assert.match(charactersBlock({ characters: [{ name: 'Aanya', role: 'age 5, the hero' }] }), /Aanya/);
  assert.strictEqual(charactersBlock({ characters: [] }), '');
  assert.match(kidsDirective({ ageBand: '3-5' }), /CHILDREN'S BOOK/);
  assert.strictEqual(kidsDirective({}), '');
  const o = outlinePrompt({ request: 'a dragon', ageBand: '3-5', characters: [{ name: 'Mia', role: 'kid' }] }, {});
  assert.match(o, /CHILDREN'S BOOK/);
  assert.match(o, /Mia/);
  const c = chapterPrompt({ title: 'T', genre: 'kids', audience: 'A', premise: 'p', themes: [], ageBand: '3-5', characters: [{ name: 'Mia', role: 'kid' }] }, { number: 1, title: 'C', beats: [], summary: 's' }, '', 45, {});
  assert.match(c, /CHILDREN'S BOOK/);
  assert.match(c, /Mia/);
});

test('Nano Banana image prompts avoid text and name characters', () => {
  const { coverImagePrompt, sceneImagePrompt } = require('../src/main/book/prompts');
  const book = { title: 'Dragon', genre: 'adventure', premise: 'brave', ageBand: '3-5', characters: [{ name: 'Mia', role: 'hero' }] };
  assert.match(coverImagePrompt(book), /Mia/);
  assert.match(coverImagePrompt(book), /Do NOT render any text/i);
  assert.match(sceneImagePrompt(book, { title: 'C', summary: 's' }, 'a forest'), /NO text/i);
});
