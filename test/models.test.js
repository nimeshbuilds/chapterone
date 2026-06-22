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
