'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extractJson } = require('../src/main/book/json');

test('parses plain JSON', () => {
  assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 });
});

test('parses fenced JSON', () => {
  const out = extractJson('Here you go:\n```json\n{"title":"X","chapters":[1,2]}\n```\nThanks!');
  assert.strictEqual(out.title, 'X');
  assert.deepStrictEqual(out.chapters, [1, 2]);
});

test('extracts JSON embedded in prose', () => {
  const out = extractJson('Sure. {"needsClarification": true, "questions": []} Done.');
  assert.strictEqual(out.needsClarification, true);
});

test('handles braces inside strings', () => {
  const out = extractJson('{"text":"a } b { c","n":2}');
  assert.strictEqual(out.text, 'a } b { c');
  assert.strictEqual(out.n, 2);
});

test('parses arrays', () => {
  assert.deepStrictEqual(extractJson('[1,2,3]'), [1, 2, 3]);
});

test('throws on garbage', () => {
  assert.throws(() => extractJson('no json here'));
});
