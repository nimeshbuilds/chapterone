'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const script = path.resolve(__dirname, '../scripts/release-check.cjs');
const macSecrets = ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const windowsSecrets = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
const unsignedEnv = Object.fromEntries([...macSecrets, ...windowsSecrets].map((key) => [`${key}_PRESENT`, 'false']));
const hash = (data) => createHash('sha256').update(data).digest('hex');

function check(args, env = {}, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, ...unsignedEnv, GITHUB_REF_TYPE: 'branch', GITHUB_OUTPUT: '', ALLOW_UNSIGNED: '',
      CHAPTERONE_UNSIGNED_WINDOWS_VERSION: '',
      MAC_SIGNING: '', WINDOWS_SIGNING: '', ...env },
  });
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'release'));
  return dir;
}

test('release refuses a tag for a different package version', () => {
  assert.equal(check([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}` }).status, 0);
  const wrong = check([], { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.0-wrong' });
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /does not match package version/);
});

test('publication requires every signing credential and ignores obsolete unsigned overrides', () => {
  assert.notEqual(check(['--signing']).status, 0);
  const unsigned = check(['--signing'], { ALLOW_UNSIGNED: 'true', RELEASE_ALLOW_UNSIGNED: 'true' });
  assert.notEqual(unsigned.status, 0);
  assert.match(unsigned.stderr, /Signed releases require all signing secrets/);
  const configured = Object.fromEntries([...macSecrets, ...windowsSecrets].map((key) => [`${key}_PRESENT`, 'true']));
  for (const key of [...macSecrets, ...windowsSecrets]) {
    const partial = check(['--signing'], { ...configured, ALLOW_UNSIGNED: 'true', [`${key}_PRESENT`]: 'false' });
    assert.notEqual(partial.status, 0, key);
    assert.ok(partial.stderr.includes(`Missing: ${key}.`));
  }
  const signed = check(['--signing'], configured);
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /mac_signing=signed\nwindows_signing=signed/);
});

test('unsigned Windows exception requires the exact version and never waives Mac or partial credentials', () => {
  const mac = Object.fromEntries(macSecrets.map((key) => [`${key}_PRESENT`, 'true']));
  const approved = { ...mac, CHAPTERONE_UNSIGNED_WINDOWS_VERSION: version };
  const result = check(['--signing'], approved);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mac_signing=signed\nwindows_signing=unsigned/);
  assert.notEqual(check(['--signing'], { ...approved, CHAPTERONE_UNSIGNED_WINDOWS_VERSION: '0.0.0-wrong' }).status, 0);
  for (const key of macSecrets) {
    assert.notEqual(check(['--signing'], { ...approved, [`${key}_PRESENT`]: 'false' }).status, 0, key);
  }
  for (const key of windowsSecrets) {
    assert.notEqual(check(['--signing'], { ...approved, [`${key}_PRESENT`]: 'true' }).status, 0, key);
  }
  const signed = check(['--signing'], { ...approved, ...Object.fromEntries(windowsSecrets.map((key) => [`${key}_PRESENT`, 'true'])) });
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /windows_signing=signed/);
});

test('release notes reject unsigned platforms and pin the exact source and build', (t) => {
  const cwd = fixture(t);
  assert.notEqual(check(['--notes'], {}, cwd).status, 0);
  const env = { MAC_SIGNING: 'signed', WINDOWS_SIGNING: 'signed', GITHUB_REPOSITORY: 'example/chapterone',
    GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '123' };
  for (const platform of ['MAC_SIGNING', 'WINDOWS_SIGNING']) {
    assert.notEqual(check(['--notes'], { ...env, [platform]: 'unsigned' }, cwd).status, 0);
  }
  const result = check(['--notes'], env, cwd);
  assert.equal(result.status, 0, result.stderr);
  const notes = fs.readFileSync(path.join(cwd, 'release/RELEASE_NOTES.md'), 'utf8');
  assert.match(notes, /\*\*macOS signing:\*\* Developer ID signed and notarized/);
  assert.match(notes, /\*\*Windows signing:\*\* Authenticode signed and timestamped/);
  assert.match(notes, /example\/chapterone\/actions\/runs\/123/);
  assert.ok(notes.includes(`example/chapterone/commit/${env.GITHUB_SHA}`));
  assert.doesNotMatch(notes, /\{\{/);
  const unsigned = check(['--notes'], { ...env, WINDOWS_SIGNING: 'unsigned', CHAPTERONE_UNSIGNED_WINDOWS_VERSION: version }, cwd);
  assert.equal(unsigned.status, 0, unsigned.stderr);
  const unsignedNotes = fs.readFileSync(path.join(cwd, 'release/RELEASE_NOTES.md'), 'utf8');
  assert.match(unsignedNotes, /\*\*Windows signing:\*\* UNSIGNED/);
  assert.match(unsignedNotes, /Publisher identity is not verified/);
  assert.doesNotMatch(unsignedNotes, /Authenticode signed and timestamped/);
  assert.notEqual(check(['--notes'], { ...env, MAC_SIGNING: 'unsigned', WINDOWS_SIGNING: 'unsigned', CHAPTERONE_UNSIGNED_WINDOWS_VERSION: version }, cwd).status, 0);
});

test('release packaging cannot disable required signatures or Mac notarization', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.resolve(__dirname, '../electron-builder.config.js'), 'utf8');
  const config = (env, platform) => {
    const context = { module: { exports: {} }, process: { env, platform }, require: () => require('../package.json') };
    vm.runInNewContext(source, context);
    return context.module.exports;
  };
  for (const trigger of [{ CHAPTERONE_RELEASE: 'true' }, { GITHUB_REF_TYPE: 'tag' }]) {
    assert.throws(() => config({ ...trigger, CHAPTERONE_ALLOW_UNSIGNED_RELEASE: 'true' }, 'darwin'), /notarization credentials/);
    const mac = config({ ...trigger, APPLE_KEYCHAIN_PROFILE: 'synthetic-test-profile' }, 'darwin');
    assert.equal(mac.forceCodeSigning, true);
    assert.equal(mac.mac.forceCodeSigning, true);
    assert.equal(mac.mac.notarize, true);
    assert.equal(mac.dmg.sign, true);
    const win = config(trigger, 'win32');
    assert.equal(win.win.forceCodeSigning, true);
    assert.equal(win.forceCodeSigning, true);
    const exception = { ...trigger, CHAPTERONE_UNSIGNED_WINDOWS_VERSION: require('../package.json').version };
    const unsignedWin = config(exception, 'win32');
    assert.equal(unsignedWin.forceCodeSigning, false);
    assert.equal(unsignedWin.win.forceCodeSigning, false);
    assert.throws(() => config(exception, 'darwin'), /notarization credentials/);
    const stillSignedMac = config({ ...exception, APPLE_KEYCHAIN_PROFILE: 'synthetic-test-profile' }, 'darwin');
    assert.equal(stillSignedMac.forceCodeSigning, true);
    assert.equal(stillSignedMac.mac.forceCodeSigning, true);
    assert.equal(stillSignedMac.mac.notarize, true);
    assert.equal(stillSignedMac.dmg.sign, true);
    assert.equal(config({ ...trigger, CHAPTERONE_UNSIGNED_WINDOWS_VERSION: '0.0.0-wrong' }, 'win32').forceCodeSigning, true);
  }
  // Pull-request tests never need access to private signing credentials.
  assert.equal(config({}, 'darwin').forceCodeSigning, false);
});

test('publication requires all installers and rejects corrupt or incomplete GitHub uploads', (t) => {
  const cwd = fixture(t);
  assert.notEqual(check(['--assets'], {}, cwd).status, 0);
  const names = [
    `ChapterOne-${version}-mac-universal.dmg`, `ChapterOne-${version}-mac-universal.zip`,
    `ChapterOne-${version}-win-x64-setup.exe`, `ChapterOne-${version}-win-arm64-setup.exe`,
  ];
  for (const [index, name] of names.entries()) fs.writeFileSync(path.join(cwd, 'release', name), Buffer.alloc(1024 * 1024, index));
  const result = check(['--assets'], {}, cwd);
  assert.equal(result.status, 0, result.stderr);
  const sums = fs.readFileSync(path.join(cwd, 'release/SHA256SUMS.txt'), 'utf8');
  for (const name of names) assert.ok(sums.includes(`${hash(fs.readFileSync(path.join(cwd, 'release', name)))}  ${name}\n`));
  const uploaded = { tag_name: `v${version}`, draft: true, assets: [...names, 'SHA256SUMS.txt'].map((name) => {
    const data = fs.readFileSync(path.join(cwd, 'release', name));
    return { name, state: 'uploaded', size: data.length, digest: `sha256:${hash(data)}` };
  }) };
  const remoteCheck = () => {
    fs.writeFileSync(path.join(cwd, 'release/uploaded-release.json'), JSON.stringify(uploaded));
    return check(['--uploaded-assets'], {}, cwd);
  };
  assert.equal(remoteCheck().status, 0);
  uploaded.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  assert.notEqual(remoteCheck().status, 0);
  uploaded.assets.shift();
  assert.notEqual(remoteCheck().status, 0);
  fs.writeFileSync(path.join(cwd, 'release', names[0]), 'truncated');
  assert.match(check(['--assets'], {}, cwd).stderr, /unexpectedly small/);
});
