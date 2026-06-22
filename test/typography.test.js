'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const t = require('../src/main/book/typography');

test('tidyProse removes dashes but keeps compound hyphens', () => {
  const out = t.tidyProse('It was cold—bitterly cold—and the state-of-the-art radio hummed.');
  assert.doesNotMatch(out, /[—–]/);
  assert.match(out, /cold, bitterly cold, and/);
  assert.match(out, /state-of-the-art/);
});

test('tidyProse strips horizontal rules, keeps headings + image markers, curls quotes', () => {
  const out = t.tidyProse('# Chapter One\n\nShe said "hi".\n\n---\n\n![](bwimg:nano-1-1)\n');
  assert.match(out, /^# Chapter One/m);
  assert.doesNotMatch(out, /^---$/m);
  assert.match(out, /!\[\]\(bwimg:nano-1-1\)/);
  assert.match(out, /[“”]/);
});

test('tidyText cleans titles', () => {
  assert.strictEqual(t.tidyText('The Fear—Is *Data*'), 'The Fear, Is Data');
});

test('markdownToSpeech yields clean speakable text and skips code blocks', () => {
  const s = t.markdownToSpeech('# Title\n\nHello **world** and `code`.\n\n```js\nconst x = 1;\n```\n\n![](bwimg:x)\n');
  assert.doesNotMatch(s, /[#*`]/);
  assert.match(s, /^Title/);
  assert.match(s, /Hello world and code\./);
  assert.doesNotMatch(s, /const x = 1/); // code is not narrated
});

test('tidyProse preserves fenced code blocks verbatim (no dash/quote munging)', () => {
  const out = t.tidyProse('Intro line.\n\n```js\nconst a = 1 - 2; // keep "this" dash\n```\n\nAfter.');
  assert.match(out, /```js/);
  assert.match(out, /const a = 1 - 2;/);   // inner dash untouched
  assert.match(out, /"this"/);              // inner quotes not curled
});

test('tidyProse keeps inline code and never corrupts standalone numbers', () => {
  const out = t.tidyProse('In 2024 run the `docker run` command — fast.');
  assert.match(out, /`docker run`/);        // inline code intact
  assert.match(out, /\b2024\b/);            // number not eaten by the span sentinel
  assert.doesNotMatch(out, /undefined/);
  assert.match(out, /command, fast\./);     // em-dash still becomes a comma
});
