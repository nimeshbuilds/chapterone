'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { GrokAdapter } = require('../src/main/cli/grokAdapter');
const { providerList, modelsFor, loginFor, SUBSCRIPTION_SCRUB } = require('../src/main/cli/models');
const { buildAdapter, resolveChain, verifyModel } = require('../src/main/cli/index');

test('verifyModel treats an empty model as valid (uses the plan default)', async () => {
  const r = await verifyModel('grok', '', {});
  assert.strictEqual(r.valid, true);
  assert.match(r.detail, /default/i);
});

test('grok buildArgs uses headless -p with no-auto-update and folds in the system prompt', () => {
  const args = new GrokAdapter({}).buildArgs('write a chapter', { system: 'SYS' });
  assert.ok(args.includes('--no-auto-update'));
  const p = args[args.indexOf('-p') + 1];
  assert.match(p, /SYS/);
  assert.match(p, /write a chapter$/);
  assert.match(p, /Do NOT narrate/i); // no-narration rule folded in
});

test('grok model flag only when configured', () => {
  assert.ok(!new GrokAdapter({}).buildArgs('x', {}).includes('--model'));
  const args = new GrokAdapter({ model: 'grok-build' }).buildArgs('x', {});
  assert.strictEqual(args[args.indexOf('--model') + 1], 'grok-build');
});

test('grok scrubs the xAI API-key env vars to force the subscription', () => {
  assert.deepStrictEqual(SUBSCRIPTION_SCRUB.grok, ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']);
  assert.deepStrictEqual(new GrokAdapter({}).scrub(), ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY']);
  assert.deepStrictEqual(new GrokAdapter({ forceSubscription: false }).scrub(), []);
});

test('grok is a first-class provider in the catalog + chain', () => {
  assert.ok(providerList().some((p) => p.id === 'grok' && p.label === 'Grok'));
  assert.ok(modelsFor('grok').some((m) => m.id === 'grok-build'));
  assert.ok(typeof loginFor('grok').hint === 'string' && /xAI/.test(loginFor('grok').hint));
  assert.strictEqual(buildAdapter('grok', {}).id, 'grok');
  assert.deepStrictEqual(resolveChain({ provider: 'grok', chain: ['grok', 'claude'] }), ['grok', 'claude']);
});

test('grok extractFinal strips banner/status lines', () => {
  const out = new GrokAdapter({}).extractFinal('grok: thinking\nmodel: grok-build\n---\nThe actual answer.\ntokens used: 5');
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

test('grok strips agentic narration/preamble but keeps real prose', () => {
  const { GrokAdapter, isNarration } = require('../src/main/cli/grokAdapter');
  const a = new GrokAdapter({});
  assert.ok(isNarration('Verifying local details for Merritt Vista, then producing the full revised chapter.'));
  assert.ok(isNarration("I'll verify a few SeaWorld facts first, then write the poem."));
  assert.ok(isNarration('Writing the full sixteen-page chapter from the brief and verified setting details.'));
  assert.ok(!isNarration('First, the sun rose over the quiet town.')); // genuine prose
  assert.ok(!isNarration('Chirp and rustle, rock and peep!'));
  // leading preamble removed, content preserved
  const out = a.extractFinal("I'll verify the facts, then write.\n\nFar-Off SeaWorld Hush\nPage 1\nChirp and peep!");
  assert.match(out, /^Far-Off SeaWorld Hush/);
  assert.doesNotMatch(out, /verify the facts/);
});

test('grok system prompt forbids narration', () => {
  const args = new GrokAdapter({}).buildArgs('write ch1', { system: 'You are an author.' });
  assert.match(args[args.indexOf('-p') + 1], /Do NOT narrate/i);
});
