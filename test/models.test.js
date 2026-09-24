'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { modelsFor, SUBSCRIPTION_SCRUB, MODEL_PRESETS, MODEL_NOTICES } = require('../src/main/cli/models');

test('model lists per provider', () => {
  assert.ok(modelsFor('claude').some((m) => m.id === 'opus'));
  assert.ok(modelsFor('codex').some((m) => m.id === 'gpt-6-astra'));
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
  assert.strictEqual(presetModel('codex', 'fast'), 'gpt-6-luna');
  assert.strictEqual(presetModel('codex', 'pro'), 'gpt-6-sol');
  assert.strictEqual(presetModel('gemini', 'fast'), 'gemini-3.5-flash-lite');
  assert.strictEqual(presetModel('gemini', 'pro'), 'gemini-3.1-pro-preview');
  assert.strictEqual(presetModel('grok', 'fast'), '');
  assert.strictEqual(presetModel('grok', 'pro'), 'grok-build');
  // default falls back gracefully
  assert.strictEqual(presetModel('claude', 'default'), '');
  assert.strictEqual(presetModel('gemini', 'default'), 'gemini-flash-latest');
});

test('every preset is selectable, IDs are unique, and CLI defaults omit model overrides', () => {
  const { buildAdapter } = require('../src/main/cli');
  for (const [provider, presets] of Object.entries(MODEL_PRESETS)) {
    const ids = modelsFor(provider).map(m => m.id);
    assert.strictEqual(new Set(ids).size, ids.length, provider);
    for (const model of Object.values(presets)) assert.ok(ids.includes(model), `${provider}: ${model}`);
    if (provider === 'gemini') continue;
    assert.strictEqual(ids[0], '');
    for (const model of ids) {
      const adapter = buildAdapter(provider, { [`${provider}Model`]: model });
      const args = provider === 'claude' ? adapter.buildArgs({}) : adapter.buildArgs('Book', {});
      assert.strictEqual(args.includes('--model'), !!model);
      if (model) assert.strictEqual(args[args.indexOf('--model') + 1], model);
    }
  }
});

test('retired subscription models are not offered by presets; saved pins have migration notices', () => {
  for (const id of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.3-codex-spark']) {
    assert.ok(!Object.values(MODEL_PRESETS.codex).includes(id));
    assert.match(MODEL_NOTICES.codex[id], /ChatGPT sign-in/);
    assert.match(MODEL_NOTICES.codex[id], /API-key access is separate/);
  }
  assert.ok(!Object.values(MODEL_PRESETS.grok).includes('grok-composer-2.5-fast'));
});

test('model refresh preserves saved pins and caller-selected reasoning without account probes', () => {
  const { buildAdapter, createEngine, createChainEngine } = require('../src/main/cli');
  const pins = {
    claude: 'claude-opus-5', codex: 'gpt-5.6-sol', gemini: 'gemini-2.5-flash', grok: 'my-custom-grok',
  };
  for (const [provider, model] of Object.entries(pins)) {
    const settings = { provider, [`${provider}Model`]: model };
    assert.strictEqual(buildAdapter(provider, settings).model, model);
    assert.strictEqual(createEngine(settings).model, model);
    assert.strictEqual(createEngine(settings, { model: 'custom/pinned-model' }).model, 'custom/pinned-model');
    assert.strictEqual(settings[`${provider}Model`], model);
    assert.ok(createChainEngine(settings));
  }
  const { CodexAdapter } = require('../src/main/cli/codexAdapter');
  for (const model of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']) {
    assert.ok(modelsFor('codex').some(m => m.id === model));
    const adapter = new CodexAdapter({ model, extraArgs: ['-c', 'model_reasoning_effort="high"'] });
    const args = adapter.buildArgs('Prose', {});
    assert.ok(args.includes('model_reasoning_effort="high"'));
    assert.ok(!args.includes('model_reasoning_effort="medium"'));
  }
  const opus = modelsFor('claude').find(m => m.id === 'claude-opus-5-5');
  assert.match(opus.note, /2\.1\.280/);
  assert.ok(!modelsFor('gemini').some(m => /tts|live|image|transcribe/.test(m.id)));
});
