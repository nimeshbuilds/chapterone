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

test('markdownToSpeech yields clean speakable text', () => {
  const s = t.markdownToSpeech('# Title\n\nHello **world** and `code`.\n\n![](bwimg:x)\n');
  assert.doesNotMatch(s, /[#*`]/);
  assert.match(s, /^Title/);
  assert.match(s, /Hello world and code\./);
});
