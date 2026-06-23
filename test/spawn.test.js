'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/main/cli/spawn');

const NODE = process.execPath;

test('passes stdin through and captures stdout', async () => {
  const { stdout, code } = await run(NODE, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'hello' });
  assert.strictEqual(code, 0);
  assert.strictEqual(stdout.trim(), 'hello');
});

test('scrubEnv removes API-key vars so the child cannot see them', async () => {
  const args = ['-e', 'process.stdout.write(process.env.ANTHROPIC_API_KEY || "GONE")'];
  const withKey = await run(NODE, args, { env: { ANTHROPIC_API_KEY: 'secret' } });
  assert.strictEqual(withKey.stdout.trim(), 'secret');
  const scrubbed = await run(NODE, args, { env: { ANTHROPIC_API_KEY: 'secret' }, scrubEnv: ['ANTHROPIC_API_KEY'] });
  assert.strictEqual(scrubbed.stdout.trim(), 'GONE');
});

test('reports non-zero exit codes', async () => {
  const { code } = await run(NODE, ['-e', 'process.exit(3)']);
  assert.strictEqual(code, 3);
});

test('aborting a running child rejects with a clear cancellation (never a partial success)', async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(
    run(NODE, ['-e', 'setTimeout(()=>{}, 10000)'], { signal: ac.signal }),
    /cancel/i,
  );
});
