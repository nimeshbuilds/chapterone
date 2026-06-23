'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { CodexAdapter } = require('../src/main/cli/codexAdapter');

test('buildArgs uses exec + skip-git-repo-check and appends the prompt', () => {
  const args = new CodexAdapter({}).buildArgs('write a chapter', {});
  assert.strictEqual(args[0], 'exec');
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.strictEqual(args[args.length - 1], 'write a chapter');
});

test('buildArgs folds the system prompt into the prompt text', () => {
  const args = new CodexAdapter({}).buildArgs('BODY', { system: 'SYS' });
  assert.strictEqual(args[args.length - 1], 'SYS\n\nBODY');
});

test('research grounding uses the config tool toggle, NOT the removed --search flag', () => {
  const args = new CodexAdapter({}).buildArgs('x', { research: true });
  assert.ok(!args.includes('--search')); // --search errors on modern Codex
  const i = args.indexOf('-c');
  assert.ok(args.includes('tools.web_search=true'));
  assert.ok(args.indexOf('tools.web_search=true') > -1);
});

test('reasoning effort defaults to medium (xhigh burns the quota), overridable via extraArgs', () => {
  const def = new CodexAdapter({}).buildArgs('x', {});
  assert.ok(def.includes('model_reasoning_effort="medium"'));
  const overridden = new CodexAdapter({ extraArgs: ['-c', 'model_reasoning_effort="high"'] }).buildArgs('x', {});
  assert.ok(!overridden.includes('model_reasoning_effort="medium"'));
  assert.ok(overridden.includes('model_reasoning_effort="high"'));
});

test('model flag is added only when a model is configured', () => {
  assert.ok(!new CodexAdapter({}).buildArgs('x', {}).includes('--model'));
  const args = new CodexAdapter({ model: 'gpt-5.5' }).buildArgs('x', {});
  assert.strictEqual(args[args.indexOf('--model') + 1], 'gpt-5.5');
});
