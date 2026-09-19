'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveUserPath, commonDirs } = require('../src/main/cli/envPath');

test('resolveUserPath returns a non-empty, de-duplicated PATH', () => {
  const p = resolveUserPath();
  assert.ok(typeof p === 'string' && p.length > 0);
  const parts = p.split(path.delimiter);
  assert.strictEqual(parts.length, new Set(parts).size, 'no duplicate entries');
});

test('commonDirs includes well-known CLI install locations', () => {
  const dirs = commonDirs();
  assert.ok(dirs.some((d) => d.includes(path.join('.local', 'bin'))));
  assert.ok(dirs.some((d) => d.includes('homebrew') || d.includes('/usr/local/bin')));
});

test('Windows PATH includes the per-user npm and native CLI install directories', { skip: process.platform !== 'win32' }, () => {
  const parts = resolveUserPath().split(path.delimiter);
  if (process.env.APPDATA) assert.ok(parts.includes(path.join(process.env.APPDATA, 'npm')));
  assert.ok(parts.includes(path.join(require('node:os').homedir(), '.local', 'bin')));
});
