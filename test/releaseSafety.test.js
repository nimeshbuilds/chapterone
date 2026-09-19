'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { chapterToHtml } = require('../src/main/export/html');
const { audioCachePath } = require('../src/main/book/audioCache');
const { loginCommand } = require('../src/main/cli/loginCommand');
const { safeFilename } = require('../src/main/util');
const { isTrustedSender, UI_URL, configureOfflineSession } = require('../src/main/security');
const { exportDocx } = require('../src/main/export/docx');

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('clearing data removes the previous credential backup and interrupted writes', (t) => {
  const s = new Store(temp(t));
  s.saveSettings({ audio: { elevenApiKey: 'fake-old-secret' } });
  s.saveSettings({ authorName: 'Someone' });
  fs.writeFileSync(s.settingsPath + '.123.tmp', 'fake-old-secret');
  s.clearAllData();
  assert.equal(s.getSettings().audio.elevenApiKey, '');
  assert.ok(!fs.readdirSync(s.baseDir).some((f) => f.startsWith('settings.json')));
});

test('deleting a book removes its art and narration without touching another book', (t) => {
  const s = new Store(temp(t));
  for (const id of ['first', 'second']) {
    s.saveBook({ id, chapters: [] });
    for (const parent of [s.audioDir, s.imagesDir]) {
      fs.mkdirSync(path.join(parent, id));
      fs.writeFileSync(path.join(parent, id, 'artifact'), 'data');
    }
  }
  s.deleteBook('first');
  assert.equal(fs.existsSync(path.join(s.audioDir, 'first')), false);
  assert.equal(fs.existsSync(path.join(s.imagesDir, 'first')), false);
  assert.equal(fs.existsSync(path.join(s.imagesDir, 'second', 'artifact')), true);
  assert.throws(() => s.deleteBook('../escape'), /Invalid book id/);
});

test('saving from a valid backup does not preserve a corrupt primary', (t) => {
  const s = new Store(temp(t));
  s.saveSettings({ authorName: 'Recovered' });
  s.saveSettings({ authorName: 'Latest' });
  fs.writeFileSync(s.settingsPath, '{broken');
  s.saveSettings({ research: false });
  assert.equal(s.getSettings().authorName, 'Recovered');
  assert.equal(JSON.parse(fs.readFileSync(s.settingsPath + '.bak')).authorName, 'Recovered');
});

test('unreadable settings are preserved instead of silently overwriting credentials', (t) => {
  const s = new Store(temp(t));
  fs.writeFileSync(s.settingsPath, '{broken');
  assert.throws(() => s.saveSettings({}), /preserved/);
  assert.equal(fs.readFileSync(s.settingsPath, 'utf8'), '{broken');
});

test('OS credential codec encrypts current and backup secrets and migrates legacy files', (t) => {
  // A reversible fake codec verifies the storage contract, not OS cryptography.
  const codec = { isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s.split('').reverse().join('')),
    decryptString: (b) => b.toString().split('').reverse().join('') };
  const dir = temp(t);
  const old = new Store(dir);
  old.saveSettings({ images: { geminiApiKey: 'fake-google-secret' }, kindle: { smtp: { pass: 'fake-mail-secret' } } });
  old.saveSettings({ audio: { elevenApiKey: 'fake-audio-secret' } });
  const s = new Store(dir, { secretStorage: codec });
  s.migrateSecrets();
  assert.equal(s.getSettings().images.geminiApiKey, 'fake-google-secret');
  s.saveSettings({ authorName: 'An Author' });
  for (const file of [s.settingsPath, s.settingsPath + '.bak']) {
    const raw = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(raw, /fake-(google|audio|mail)-secret/);
    assert.match(raw, /encrypted/);
  }
  const locked = new Store(dir, { secretStorage: { isEncryptionAvailable: () => false } });
  const before = fs.readFileSync(s.settingsPath, 'utf8');
  assert.throws(() => locked.saveSettings({}), /Unlock/);
  assert.equal(fs.readFileSync(s.settingsPath, 'utf8'), before);
});

test('book markup strips active content, CSS and remote/local image loads', () => {
  const html = chapterToHtml('<script>bad()</script><iframe src="file:///secret"></iframe>'
    + '<form action="https://bad.test"><input name="key"></form><style>body{display:none}</style>'
    + '<p onclick=bad()>Safe <strong>prose</strong></p><img src="https://bad.test/pixel">'
    + '<img src="file:///secret"><a href="java&#x73;cript:bad()">link</a>');
  assert.doesNotMatch(html, /script|iframe|form|input|style|onclick|https:\/\/bad|file:/i);
  assert.match(html, /Safe <strong>prose<\/strong>/);
});

test('book image resolution retains embedded raster and EPUB images', () => {
  assert.match(chapterToHtml('![Caption](bwimg:one)', () => 'data:image/png;base64,YQ=='), /data:image\/png/);
  assert.match(chapterToHtml('![Caption](bwimg:one)', () => 'images/one.png'), /images\/one.png/);
  assert.doesNotMatch(chapterToHtml('![Caption](bwimg:one)', () => '" onerror="bad()'), /onerror/);
});

test('narration cache depends on text, voice and model and cannot traverse paths', () => {
  const ch = { number: 1, content: 'Original words.' };
  const first = audioCachePath('/audio', ch, 'voice', 'model');
  assert.notEqual(first, audioCachePath('/audio', { ...ch, content: 'Edited words.' }, 'voice', 'model'));
  assert.notEqual(first, audioCachePath('/audio', ch, 'new-voice', 'model'));
  assert.notEqual(first, audioCachePath('/audio', ch, 'voice', 'new-model'));
  assert.match(path.basename(audioCachePath('/audio', ch, '../../outside', 'model')), /^[a-f0-9]{64}\.mp3$/);
});

test('IPC requires the exact top-level app document', () => {
  const main = { url: UI_URL };
  assert.equal(isTrustedSender({ senderFrame: main, sender: { mainFrame: main } }), true);
  assert.equal(isTrustedSender({ senderFrame: { url: UI_URL }, sender: { mainFrame: main } }), false);
  assert.equal(isTrustedSender({ senderFrame: { url: 'https://bad.test' }, sender: { mainFrame: main } }), false);
});

test('offline rendering only permits its exact main document and data resources', (t) => {
  const { pathToFileURL } = require('url');
  const file = path.join(temp(t), 'Book with spaces and é.html');
  fs.writeFileSync(file, '<h1>Safe</h1>');
  let filter;
  configureOfflineSession({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest(fn) { filter = fn; } } }, file);
  const url = pathToFileURL(file).href;
  for (const url of ['https://bad.test', 'file:///etc/passwd', pathToFileURL(file).href]) {
    filter({ url, resourceType: 'image' }, ({ cancel }) => assert.equal(cancel, true));
  }
  filter({ url, resourceType: 'mainFrame' }, ({ cancel }) => assert.equal(cancel, false));
  filter({ url: pathToFileURL(fs.realpathSync.native(file)).href, resourceType: 'mainFrame' }, ({ cancel }) => assert.equal(cancel, false));
  filter({ url: 'file://server/private/book.html', resourceType: 'mainFrame' }, ({ cancel }) => assert.equal(cancel, true));
  filter({ url: 'data:image/png;base64,YQ==', resourceType: 'image' }, ({ cancel }) => assert.equal(cancel, false));
});

test('terminal login quotes paths and rejects Windows expansion/metacharacters', () => {
  assert.equal(loginCommand('C:\\Program Files\\CLI\\cli.exe', ['login'], 'win32'), '"C:\\Program Files\\CLI\\cli.exe" "login"');
  assert.throws(() => loginCommand('cli & calc', ['login'], 'win32'), /unsupported/);
  assert.throws(() => loginCommand('%COMSPEC%', [], 'win32'), /unsupported/);
  assert.equal(loginCommand('/some path/cli', ['login'], 'darwin'), "'/some path/cli' 'login'");
  assert.throws(() => loginCommand('cli\nother'), /Invalid/);
});

test('export filenames avoid Windows device names on every OS', () => {
  for (const name of ['CON', 'nul', 'COM1', 'LPT9.txt']) assert.ok(safeFilename(name).startsWith('_'));
  assert.equal(safeFilename('A good book'), 'A_good_book');
});

test('DOCX rejects unwritable destinations instead of crashing the app', async (t) => {
  await assert.rejects(exportDocx({ title: 'Test', chapters: [] }, path.join(temp(t), 'missing', 'book.docx')), /ENOENT/);
});
