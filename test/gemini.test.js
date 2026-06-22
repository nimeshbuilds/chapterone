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

test('provider catalog includes all three with login metadata', () => {
  const ids = providerList().map((p) => p.id);
  assert.deepStrictEqual(ids, ['claude', 'codex', 'gemini']);
  assert.ok(modelsFor('gemini').some((m) => m.id === 'gemini-flash-latest'));
  assert.ok(loginFor('codex').args.includes('login'));
  assert.ok(typeof loginFor('gemini').hint === 'string');
});
