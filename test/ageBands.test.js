'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ab = require('../src/main/book/ageBands');

test('all six age bands exist and resolve', () => {
  assert.deepStrictEqual(ab.AGE_BAND_KEYS, ['1-2', '3-5', '6-8', '9-12', '13-16', '17-18']);
  assert.strictEqual(ab.bandOf('3-5').key, '3-5');
  assert.strictEqual(ab.bandOf({ ageBand: '9-12' }).key, '9-12');
  assert.strictEqual(ab.bandOf(ab.bandOf('1-2')).key, '1-2'); // idempotent on a band object
  assert.strictEqual(ab.bandOf('nope'), null);
});

test('image density scales with age band', () => {
  assert.strictEqual(ab.plannedImageCount('3-5'), 16);  // picture book: every page
  assert.strictEqual(ab.plannedImageCount('6-8'), 16);  // 8 chapters x 2
  assert.strictEqual(ab.plannedImageCount('9-12'), 4);  // occasional
  assert.strictEqual(ab.plannedImageCount('13-16'), 0); // YA: none
  assert.strictEqual(ab.imagesForUnitIndex('9-12', 0), 1);
  assert.strictEqual(ab.imagesForUnitIndex('9-12', 1), 0);
});

test('export CSS varies font by band; reader vars provided', () => {
  assert.match(ab.cssForBand('3-5'), /Comic Sans|font-size: 1\.55rem/);
  assert.doesNotMatch(ab.cssForBand('13-16'), /Comic Sans/);
  assert.strictEqual(ab.cssForBand('nope'), '');
  assert.strictEqual(ab.readerVarsForBand('1-2').young, true);
  assert.strictEqual(ab.readerVarsForBand('9-12').young, false);
});
