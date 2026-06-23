'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyBook, BAND_CATEGORIES } = require('../src/main/book/classify');

test('kids books map their age band to the standard format category', () => {
  assert.strictEqual(classifyBook({ ageBand: '3-5' }).label, 'Picture Book · Ages 3–5');
  assert.strictEqual(classifyBook({ ageBand: '1-2' }).category, 'Board Book');
  assert.strictEqual(classifyBook({ ageBand: '6-8' }).category, 'Early Reader');
  assert.strictEqual(classifyBook({ ageBand: '9-12' }).category, 'Middle Grade');
  assert.strictEqual(classifyBook({ ageBand: '13-16' }).audience, 'Young Adult');
  assert.ok(classifyBook({ ageBand: '3-5' }).kids);
});

test('age band can come from the spec too', () => {
  assert.strictEqual(classifyBook({ spec: { ageBand: '9-12' } }).category, 'Middle Grade');
});

test('non-kids books are Adult, split into fiction vs nonfiction', () => {
  assert.strictEqual(classifyBook({ genre: 'Mystery / Thriller' }).label, 'Adult · Fiction');
  assert.strictEqual(classifyBook({ spec: { kind: 'nonfiction' }, genre: 'Technology' }).label, 'Adult · Nonfiction');
  assert.strictEqual(classifyBook({ genre: 'Self Help' }).label, 'Adult · Nonfiction');
  assert.ok(!classifyBook({ genre: 'Romance' }).kids);
});

test('every band has a category + ages', () => {
  for (const k of Object.keys(BAND_CATEGORIES)) {
    assert.ok(BAND_CATEGORIES[k].category && BAND_CATEGORIES[k].ages);
  }
});
