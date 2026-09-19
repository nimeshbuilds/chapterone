'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const nb = require('../src/main/book/nanoBanana');

test('image model catalog + pricing', () => {
  assert.strictEqual(nb.DEFAULT_IMAGE_MODEL, 'gemini-3.1-flash-image');
  assert.strictEqual(nb.priceFor('gemini-3.1-flash-lite-image'), 0.0336);
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-3-pro-image'));
  assert.ok(nb.IMAGE_MODELS.some((m) => m.id === 'gemini-2.5-flash-image'));
  assert.strictEqual(nb.priceFor('gemini-3-pro-image'), 0.134);
  assert.match(nb.modelLabel('gemini-3-pro-image'), /Pro/);
});

test('image models send supported requests and return final images instead of thinking drafts', async (t) => {
  const https = require('https');
  const { EventEmitter } = require('events');
  const calls = [];
  t.mock.method(https, 'request', (options, callback) => {
    const req = new EventEmitter();
    req.end = payload => queueMicrotask(() => {
      calls.push({ options, body: JSON.parse(payload) });
      const res = new EventEmitter();
      res.statusCode = 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify({ candidates: [{ content: { parts: [
        { thought: true, inlineData: { mimeType: 'image/png', data: Buffer.from('DRAFT').toString('base64') } },
        { text: 'Finished illustration' },
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('FINAL').toString('base64') } },
      ] } }] })));
      res.emit('end');
      req.emit('close');
    });
    return req;
  });
  for (const { id } of nb.IMAGE_MODELS) {
    const output = await nb.generateImage({ apiKey: 'test-key', model: id, prompt: 'A river', aspectRatio: '2:3',
      referenceImages: [{ mime: 'image/png', data: 'UkVG' }] });
    assert.strictEqual(output.buffer.toString(), 'FINAL');
    assert.strictEqual(output.ext, 'jpg');
    const { options, body } = calls.at(-1);
    assert.strictEqual(options.path, `/v1beta/models/${id}:generateContent`);
    assert.strictEqual(options.headers['x-goog-api-key'], 'test-key');
    assert.deepStrictEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'] });
    assert.deepStrictEqual(body.contents[0].parts[0], { inline_data: { mime_type: 'image/png', data: 'UkVG' } });
    assert.match(body.contents[0].parts[1].text, /2:3.*A river/);
  }
});

test('generateImage validates inputs before any network call', async () => {
  await assert.rejects(nb.generateImage({ prompt: 'x' }), /API key/);
  await assert.rejects(nb.generateImage({ apiKey: 'k', prompt: '' }), /image prompt is required/);
});
