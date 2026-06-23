'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { GrokAdapter } = require('../src/main/cli/grokAdapter');
const { providerList, modelsFor, loginFor, SUBSCRIPTION_SCRUB } = require('../src/main/cli/models');
const { buildAdapter, resolveChain } = require('../src/main/cli/index');

test('grok buildArgs uses headless -p with no-auto-update and folds in the system prompt', () => {
  const args = new GrokAdapter({}).buildArgs('write a chapter', { system: 'SYS' });
  assert.ok(args.includes('--no-auto-update'));
  assert.strictEqual(args[args.indexOf('-p') + 1], 'SYS\n\nwrite a chapter');
});

test('grok model flag only when configured', () => {
  assert.ok(!new GrokAdapter({}).buildArgs('x', {}).includes('--model'));
  const args = new GrokAdapter({ model: 'grok-build-0.1' }).buildArgs('x', {});
  assert.strictEqual(args[args.indexOf('--model') + 1], 'grok-build-0.1');
});

test('grok scrubs the xAI API-key env vars to force the subscription', () => {
  assert.deepStrictEqual(SUBSCRIPTION_SCRUB.grok, ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']);
  assert.deepStrictEqual(new GrokAdapter({}).scrub(), ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']);
  assert.deepStrictEqual(new GrokAdapter({ forceSubscription: false }).scrub(), []);
});

test('grok is a first-class provider in the catalog + chain', () => {
  assert.ok(providerList().some((p) => p.id === 'grok' && p.label === 'Grok'));
  assert.ok(modelsFor('grok').some((m) => m.id === 'grok-build-0.1'));
  assert.ok(typeof loginFor('grok').hint === 'string' && /xAI/.test(loginFor('grok').hint));
  assert.strictEqual(buildAdapter('grok', {}).id, 'grok');
  assert.deepStrictEqual(resolveChain({ provider: 'grok', chain: ['grok', 'claude'] }), ['grok', 'claude']);
});

test('grok extractFinal strips banner/status lines', () => {
  const out = new GrokAdapter({}).extractFinal('grok: thinking\nmodel: grok-build-0.1\n---\nThe actual answer.\ntokens used: 5');
  assert.match(out, /The actual answer\./);
  assert.doesNotMatch(out, /model:|tokens used/);
});

test('grok login uses the dedicated `grok login` command', () => {
  assert.deepStrictEqual(loginFor('grok').args, ['login']);
});

test('grok checkAuth detects the cached token file WITHOUT spawning the CLI (no browser)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const prev = process.env.GROK_HOME;
  try {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-empty-'));
    process.env.GROK_HOME = empty;
    assert.strictEqual((await new GrokAdapter({}).checkAuth()).ok, false);

    const authed = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-authed-'));
    fs.writeFileSync(path.join(authed, 'auth.json'), '{"token":"xai-abc"}');
    process.env.GROK_HOME = authed;
    assert.strictEqual((await new GrokAdapter({}).checkAuth()).ok, true);
  } finally {
    if (prev === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = prev;
  }
});
