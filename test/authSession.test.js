'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { AuthSessionManager, URL_RE } = require('../src/main/cli/authSession');

const NODE = process.execPath;

test('URL_RE finds oauth urls in output', () => {
  const m = 'Visit https://auth.example.com/device?code=ABC-123 to continue'.match(URL_RE);
  assert.deepStrictEqual(m, ['https://auth.example.com/device?code=ABC-123']);
});

test('streams output and detects a url, then closes', async () => {
  const mgr = new AuthSessionManager();
  const output = [];
  const urls = [];
  const code = await new Promise((resolve) => {
    mgr.start({
      command: NODE,
      args: ['-e', 'process.stdout.write("go to https://login.test/abc now")'],
      onOutput: (t) => output.push(t),
      onUrl: (u) => urls.push(u),
      onClose: (c) => resolve(c),
    });
  });
  assert.strictEqual(code, 0);
  assert.match(output.join(''), /login\.test/);
  assert.deepStrictEqual(urls, ['https://login.test/abc']);
});

test('forwards typed input to the child stdin', async () => {
  const mgr = new AuthSessionManager();
  let out = '';
  await new Promise((resolve) => {
    const id = mgr.start({
      command: NODE,
      args: ['-e', 'process.stdin.once("data", d => { process.stdout.write("got:" + d.toString().trim()); process.exit(0); })'],
      onOutput: (t) => { out += t; },
      onUrl: () => {},
      onClose: () => resolve(),
    });
    setTimeout(() => mgr.input(id, 'CODE42'), 100);
  });
  assert.match(out, /got:CODE42/);
});

test('cancel kills the session', async () => {
  const mgr = new AuthSessionManager();
  const code = await new Promise((resolve) => {
    const id = mgr.start({
      command: NODE,
      args: ['-e', 'setTimeout(()=>{}, 10000)'],
      onOutput: () => {}, onUrl: () => {}, onClose: (c) => resolve(c),
    });
    setTimeout(() => mgr.cancel(id), 80);
  });
  assert.notStrictEqual(code, 0);
});
