'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ChainEngine } = require('../src/main/cli/chainEngine');
const { resolveChain } = require('../src/main/cli');

function fake(id, behavior) {
  return { id, model: `${id}-m`, calls: 0, async complete(p, o) { this.calls++; return behavior(this.calls, p, o); } };
}

test('uses the first adapter when it succeeds', async () => {
  const a = fake('claude', () => 'ok-a');
  const b = fake('codex', () => 'ok-b');
  const chain = new ChainEngine([a, b]);
  assert.strictEqual(await chain.complete('x'), 'ok-a');
  assert.strictEqual(chain.id, 'claude');
  assert.strictEqual(b.calls, 0);
});

test('falls back to the next provider on a quota failure', async () => {
  const switches = [];
  const a = fake('claude', () => { throw new Error('usage limit reached on your plan'); });
  const b = fake('codex', () => 'rescued');
  const chain = new ChainEngine([a, b], { onSwitch: (i) => switches.push(i) });
  assert.strictEqual(await chain.complete('x'), 'rescued');
  assert.strictEqual(chain.id, 'codex'); // sticky to the working one
  assert.ok(switches.some((s) => s.type === 'falling-back' && s.kind === 'subscription'));
  assert.ok(switches.some((s) => s.type === 'switched' && s.toId === 'codex'));
});

test('stays on the recovered provider for later calls', async () => {
  const a = fake('claude', () => { throw new Error('429 rate limit'); });
  const b = fake('codex', () => 'b-ok');
  const chain = new ChainEngine([a, b]);
  await chain.complete('one');
  await chain.complete('two');
  assert.strictEqual(a.calls, 1); // not retried after it became inactive
  assert.strictEqual(b.calls, 2);
});

test('does not fall back on user cancellation', async () => {
  const a = fake('claude', () => { throw new Error('Generation cancelled'); });
  const b = fake('codex', () => 'b');
  const chain = new ChainEngine([a, b]);
  await assert.rejects(chain.complete('x'), /cancelled/);
  assert.strictEqual(b.calls, 0);
});

test('throws the last error when the whole chain is exhausted', async () => {
  const a = fake('claude', () => { throw new Error('network ENOTFOUND'); });
  const b = fake('codex', () => { throw new Error('insufficient credit'); });
  const switches = [];
  const chain = new ChainEngine([a, b], { onSwitch: (i) => switches.push(i) });
  await assert.rejects(chain.complete('x'), /insufficient credit/);
  assert.ok(switches.some((s) => s.type === 'exhausted'));
});

test('resolveChain puts the primary first and de-dupes', () => {
  assert.deepStrictEqual(resolveChain({ provider: 'codex', chain: ['claude', 'codex', 'gemini'] }), ['codex', 'claude', 'gemini']);
  assert.deepStrictEqual(resolveChain({ provider: 'gemini' }), ['gemini']);
  assert.deepStrictEqual(resolveChain({ provider: 'claude', chain: ['claude'] }), ['claude']);
});
