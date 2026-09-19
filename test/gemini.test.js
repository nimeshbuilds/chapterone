'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { GeminiAdapter, DEFAULT_GEMINI_MODEL, describeError } = require('../src/main/cli/geminiAdapter');
const { providerList, modelsFor, loginFor } = require('../src/main/cli/models');

test('gemini defaults to the latest-Flash alias and trims the key', () => {
  assert.strictEqual(DEFAULT_GEMINI_MODEL, 'gemini-flash-latest');
  assert.strictEqual(new GeminiAdapter({}).model, 'gemini-flash-latest');
  assert.strictEqual(new GeminiAdapter({ model: 'gemini-2.5-flash' }).model, 'gemini-2.5-flash');
  assert.strictEqual(new GeminiAdapter({ apiKey: '  AIzaTEST  ' }).apiKey, 'AIzaTEST');
});

test('gemini detect() is API-key based, not CLI based', async () => {
  assert.deepStrictEqual(await new GeminiAdapter({}).detect(), { found: false });
  assert.deepStrictEqual(await new GeminiAdapter({ apiKey: 'AIza' }).detect(), { found: true, version: 'API key' });
});

test('gemini checkAuth needs a key (no network call when missing)', async () => {
  const r = await new GeminiAdapter({}).checkAuth();
  assert.strictEqual(r.ok, false);
  assert.match(r.detail, /API key/i);
});

test('gemini error messages are actionable', () => {
  assert.match(describeError(400, '{"error":{"message":"API key not valid"}}', 'gemini-flash-latest'), /invalid/i);
  assert.match(describeError(400, '{"error":{"message":"models/foo is not found for API version v1beta"}}', 'foo'), /isn.t available/i);
  assert.match(describeError(429, '{}', 'x'), /rate limit|quota/i);
  assert.match(describeError(403, '{}', 'x'), /rejected/i);
});

test('provider catalog includes all engines with login metadata', () => {
  const ids = providerList().map((p) => p.id);
  assert.deepStrictEqual(ids, ['claude', 'codex', 'gemini', 'grok']);
  assert.ok(modelsFor('gemini').some((m) => m.id === 'gemini-flash-latest'));
  assert.ok(loginFor('codex').args.includes('login'));
  assert.ok(typeof loginFor('gemini').hint === 'string');
  assert.strictEqual(providerList().find((p) => p.id === 'gemini').npmPackage, null);
});

test('unlisted Gemini aliases are not falsely verified', async (t) => {
  const adapter = new GeminiAdapter({ apiKey: 'test-key' });
  t.mock.method(adapter, '_listModels', async () => ['gemini-2.5-flash']);
  assert.strictEqual((await adapter.verifyModel('made-up-latest')).valid, null);
  assert.strictEqual((await adapter.verifyModel('made-up-model')).valid, false);
  assert.strictEqual((await adapter.verifyModel('gemini-2.5-flash')).valid, true);
});

test('Gemini streams split UTF-8 and a final unterminated line without exposing thoughts', async (t) => {
  const https = require('https');
  const { EventEmitter } = require('events');
  const { Readable } = require('stream');
  const event = (parts) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts } }] });
  const bytes = Buffer.from(event([{ text: 'hidden', thought: true }, { text: 'café ' }]) + '\n\n'
    + event([{ text: 'finished' }]));
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  let requestOptions, body;
  t.mock.method(https, 'request', (options, callback) => {
    requestOptions = options;
    const req = new EventEmitter();
    req.end = (payload) => {
      body = JSON.parse(payload);
      const res = Readable.from([bytes.subarray(0, split), bytes.subarray(split)]);
      res.statusCode = 200;
      res.complete = true;
      queueMicrotask(() => callback(res));
    };
    return req;
  });
  const deltas = [];
  const adapter = new GeminiAdapter({ apiKey: 'test-key' });
  const output = await adapter.complete('A book', { research: true, onStdout: (s) => deltas.push(s) });
  assert.strictEqual(output, 'café finished');
  assert.strictEqual(deltas.join(''), output);
  assert.strictEqual(requestOptions.headers['x-goog-api-key'], 'test-key');
  assert.ok(!requestOptions.path.includes('test-key'));
  assert.deepStrictEqual(body.tools, [{ google_search: {} }]);
});

test('Gemini rejects a truncated stream instead of accepting a partial manuscript', async (t) => {
  const https = require('https');
  const { EventEmitter } = require('events');
  t.mock.method(https, 'request', (_options, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.complete = false;
      res.setEncoding = () => {};
      callback(res);
      res.emit('data', 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n');
      res.emit('close');
    });
    return req;
  });
  await assert.rejects(new GeminiAdapter({ apiKey: 'test-key' }).complete('A book'), /connection lost mid-stream/);
});
