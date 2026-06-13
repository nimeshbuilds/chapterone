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
  assert.match(rich, /openly-licensed|public-domain/i);
});

test('word targets scale with length', () => {
  assert.ok(targetWordsForLength('short novella') < targetWordsForLength('standard'));
  assert.ok(targetWordsForLength('epic long') > targetWordsForLength('standard'));
});
