'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const nb = require('../src/main/book/nanoBanana');

test('image model catalog + pricing', () => {
  assert.strictEqual(nb.DEFAULT_IMAGE_MODEL, 'gemini-2.5-flash-image');
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-3-pro-image'));
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-2.5-flash-image'));
  assert.strictEqual(nb.priceFor('gemini-3-pro-image'), 0.134);
  assert.match(nb.modelLabel('gemini-3-pro-image'), /Pro/);
});

test('image request uses v1beta and drops the invalid responseFormat field', () => {
  // Guards the 400 "Unknown name responseFormat / responseModalities" regression.
  const src = require('node:fs').readFileSync('src/main/book/nanoBanana.js', 'utf8');
  assert.match(src, /v1beta/);
  assert.doesNotMatch(src, /responseFormat/);
  assert.match(src, /responseModalities/);
});

test('generateImage validates inputs before any network call', async () => {
  await assert.rejects(nb.generateImage({ prompt: 'x' }), /API key/);
  await assert.rejects(nb.generateImage({ apiKey: 'k', prompt: '' }), /image prompt is required/);
});
