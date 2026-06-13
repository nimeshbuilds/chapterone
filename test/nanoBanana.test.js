'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const nb = require('../src/main/book/nanoBanana');

test('image model catalog + pricing', () => {
  assert.strictEqual(nb.DEFAULT_IMAGE_MODEL, 'gemini-3-pro-image');
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-3-pro-image'));
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-2.5-flash-image'));
  assert.strictEqual(nb.priceFor('gemini-3-pro-image'), 0.134);
  assert.match(nb.modelLabel('gemini-3-pro-image'), /Pro/);
});

test('generateImage validates inputs before any network call', async () => {
  await assert.rejects(nb.generateImage({ prompt: 'x' }), /API key/);
  await assert.rejects(nb.generateImage({ apiKey: 'k', prompt: '' }), /image prompt is required/);
});
