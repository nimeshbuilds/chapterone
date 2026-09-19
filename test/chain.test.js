'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ChainEngine: RealChainEngine } = require('../src/main/cli/chainEngine');
class ChainEngine extends RealChainEngine {
  constructor(adapters, opts = {}) { super(adapters, { delay: async () => {}, ...opts }); }
}
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

test('a too-short completion (minWords) triggers fallback to the next engine', async () => {
  const { enforceMinWords } = require('../src/main/cli/spawn');
  const limited = { id: 'a', model: '', async complete(p, o) { const out = 'usage limit reached'; enforceMinWords(out, o); return out; } };
  const good = { id: 'b', model: '', async complete() { return 'word '.repeat(300); } };
  const chain = new ChainEngine([limited, good]);
  const out = await chain.complete('write a chapter', { minWords: 200 });
  assert.ok(out.split(/\s+/).length >= 200);
  assert.strictEqual(chain.id, 'b'); // switched to the working engine
});

test('quiet calls fall back silently (no exhausted/switch broadcast)', async () => {
  const dead = { id: 'a', model: '', async complete() { throw new Error('rate limit exceeded'); } };
  const alsoDead = { id: 'b', model: '', async complete() { throw new Error('rate limit exceeded'); } };
  const events = [];
  const chain = new ChainEngine([dead, alsoDead], { onSwitch: (e) => events.push(e) });
  await assert.rejects(chain.complete('art', { quiet: true }));
  assert.strictEqual(events.length, 0); // nothing broadcast for an optional call

  // a loud call on the same chain still broadcasts
  await assert.rejects(chain.complete('chapter'));
  assert.ok(events.some((e) => e.type === 'exhausted'));
});

test('a transient network error is retried on the same adapter, not failed', async () => {
  let calls = 0;
  const flaky = { id: 'grok', model: 'grok-build', async complete() {
    calls++;
    if (calls < 3) throw new Error('getaddrinfo ENOTFOUND cli-chat-proxy.grok.com'); // network blip x2
    return 'chapter text '.repeat(50);
  } };
  const events = [];
  const chain = new ChainEngine([flaky], { onSwitch: (e) => events.push(e) });
  const out = await chain.complete('write', {});
  assert.ok(out.length > 0);          // recovered after retries
  assert.strictEqual(calls, 3);        // failed twice, succeeded on the 3rd
  assert.ok(events.some((e) => e.type === 'retrying'));
  assert.ok(!events.some((e) => e.type === 'exhausted')); // never declared failure
});
