'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { GeminiAdapter } = require('../src/main/cli/geminiAdapter');
const { providerList, modelsFor, loginFor, SUBSCRIPTION_SCRUB } = require('../src/main/cli/models');

test('gemini builds args with model and prompt', () => {
  const a = new GeminiAdapter({ model: 'gemini-2.5-pro' });
  const args = a.buildArgs('Write a chapter', { system: 'You are an author' });
  assert.deepStrictEqual(args.slice(0, 2), ['-m', 'gemini-2.5-pro']);
  assert.strictEqual(args[args.length - 2], '-p');
  assert.match(args[args.length - 1], /You are an author[\s\S]*Write a chapter/);
});

test('gemini scrubs Google api-key env by default', () => {
  assert.deepStrictEqual(new GeminiAdapter({}).scrub(), SUBSCRIPTION_SCRUB.gemini);
  assert.deepStrictEqual(new GeminiAdapter({ forceSubscription: false }).scrub(), []);
});

test('gemini strips status noise from output', () => {
  const a = new GeminiAdapter({});
  const out = a.extractFinal('Loaded cached credentials.\nThe real answer.\n');
  assert.strictEqual(out.trim(), 'The real answer.');
});

test('provider catalog includes all three with login metadata', () => {
  const ids = providerList().map((p) => p.id);
  assert.deepStrictEqual(ids, ['claude', 'codex', 'gemini']);
  assert.ok(modelsFor('gemini').some((m) => m.id === 'gemini-2.5-pro'));
  assert.ok(loginFor('codex').args.includes('login'));
  assert.ok(typeof loginFor('gemini').hint === 'string');
});
