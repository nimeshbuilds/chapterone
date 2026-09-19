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

test('Windows npm shims preserve spaces, Unicode and shell metacharacters in arguments', { skip: process.platform !== 'win32' }, async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone space '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'node_modules', 'fake-cli', 'cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  fs.writeFileSync(path.join(dir, 'fake.cmd'), '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\fake-cli\\cli.js" %*\r\n');
  const args = ['a & b | c', 'quotes " here', 'line one\nline two', 'नमस्ते 📚'];
  const result = await run('fake', args, { env: { PATH: dir, PATHEXT: '.EXE;.CMD' } });
  assert.equal(result.code, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), args);
});
