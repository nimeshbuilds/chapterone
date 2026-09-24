'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const spawn = require('../src/main/cli/spawn');

// Keep real adapter and model-verification code, replacing only the process
// boundary. No test invokes an installed provider or accesses a real account.
let runCommand;
const originalLoad = Module._load;
let cli;
try {
  Module._load = function (name, parent, isMain) {
    if (name === './spawn' && parent.filename.includes(`${path.sep}cli${path.sep}`)) {
      return { ...spawn, run: (...args) => runCommand(...args) };
    }
    return originalLoad.call(this, name, parent, isMain);
  };
  cli = require('../src/main/cli');
} finally { Module._load = originalLoad; }

for (const provider of ['claude', 'codex']) {
  const response = provider === 'claude'
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, email: 'private@example.test', authMethod: 'api_key' }), stderr: '' }
    : { code: 0, stdout: '', stderr: 'Logged in using an API key - private-key-fragment' };

  test(`${provider} auth status never generates text or exposes raw account output`, async () => {
    const calls = [];
    runCommand = async (...args) => { calls.push(args); return response; };
    const adapter = cli.buildAdapter(provider, { [`${provider}Command`]: '/custom/provider',
      [`${provider}Model`]: 'expensive-model', [`${provider}ExtraArgs`]: ['--model', 'override'] });
    const result = await adapter.checkAuth();
    assert.equal(result.ok, true);
    assert.match(result.detail, /No text was generated/);
    assert.doesNotMatch(result.detail, /private|subscription|expensive-model|override/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/custom/provider');
    assert.deepEqual(calls[0][1], provider === 'claude' ? ['auth', 'status'] : ['login', 'status']);
    assert.equal(calls[0][2].input, undefined);
    assert.equal(calls[0][2].timeoutMs, 15000);
    assert.ok(calls[0][2].scrubEnv.includes(provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'));
    await cli.buildAdapter(provider, { forceSubscription: false }).checkAuth();
    assert.deepEqual(calls[1][2].scrubEnv, []);
  });

  test(`${provider} distinguishes a signed-out result from unknown/error status without a paid fallback`, async () => {
    const adapter = cli.buildAdapter(provider);
    let calls = 0;
    let next = provider === 'claude'
      ? { code: 1, stdout: '{"loggedIn":false}', stderr: '' }
      : { code: 1, stdout: '', stderr: 'Not logged in\n' };
    runCommand = async () => { calls++; if (next instanceof Error) throw next; return next; };
    assert.equal((await adapter.checkAuth()).ok, false);
    const errors = [
      { code: 2, stdout: '', stderr: 'unknown subcommand status with private-key-fragment' },
      { code: 1, stdout: '', stderr: 'Could not read configuration at private@example.test' },
      { code: 0, stdout: '{"unexpected":true}', stderr: '' },
      new Error('Timed out with private-key-fragment'),
    ];
    for (next of errors) {
      const result = await adapter.checkAuth();
      assert.equal(result.ok, null);
      assert.doesNotMatch(result.detail, /private|Not authenticated/);
      assert.match(result.detail, /No text was generated/);
    }
    assert.equal(calls, 1 + errors.length);
  });

  test(`${provider} explicit model verification still sends its disclosed test prompt`, async () => {
    const calls = [];
    runCommand = async (...args) => { calls.push(args); return { code: 0, stdout: 'OK', stderr: '' }; };
    const result = await cli.verifyModel(provider, 'chosen-model');
    assert.equal(result.valid, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1][0], provider === 'claude' ? '-p' : 'exec');
    assert.equal(calls[0][1][calls[0][1].indexOf('--model') + 1], 'chosen-model');
    assert.match(calls[0][2].input, /Reply with exactly: OK/);
  });
}

test('Gemini auth status lists model metadata without generating text', async (t) => {
  const adapter = new cli.GeminiAdapter({ apiKey: 'test-key' });
  let metadataCalls = 0;
  t.mock.method(adapter, '_listModels', async () => { metadataCalls++; return ['a-model']; });
  t.mock.method(adapter, 'complete', async () => { throw new Error('Auth must not generate text'); });
  assert.equal((await adapter.checkAuth()).ok, true);
  assert.equal(metadataCalls, 1);
});
