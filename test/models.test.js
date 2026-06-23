'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { modelsFor, SUBSCRIPTION_SCRUB } = require('../src/main/cli/models');

test('model lists per provider', () => {
  assert.ok(modelsFor('claude').some((m) => m.id === 'opus'));
  assert.ok(modelsFor('codex').some((m) => m.id === 'gpt-5.5'));
  assert.strictEqual(modelsFor('claude')[0].id, ''); // default first
});

test('subscription scrub strips the api-key vars', () => {
  assert.ok(SUBSCRIPTION_SCRUB.claude.includes('ANTHROPIC_API_KEY'));
  assert.ok(SUBSCRIPTION_SCRUB.codex.includes('OPENAI_API_KEY'));
});

test('model presets resolve fast/pro/default for every provider', () => {
  const { presetModel } = require('../src/main/cli/models');
  assert.strictEqual(presetModel('claude', 'fast'), 'haiku');
  assert.strictEqual(presetModel('claude', 'pro'), 'opus');
  assert.strictEqual(presetModel('codex', 'fast'), 'gpt-5.4-mini');
  assert.strictEqual(presetModel('gemini', 'pro'), 'gemini-3.1-pro-preview');
  assert.strictEqual(presetModel('grok', 'fast'), 'grok-composer-2.5-fast');
  assert.strictEqual(presetModel('grok', 'pro'), 'grok-build');
  // default falls back gracefully
  assert.strictEqual(presetModel('claude', 'default'), '');
  assert.strictEqual(presetModel('gemini', 'default'), 'gemini-flash-latest');
});
