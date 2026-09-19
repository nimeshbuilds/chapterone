'use strict';

// Runs the real main process, preload, renderer and exports with a synthetic
// provider and an isolated userData directory. No accounts or API calls.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { app, BrowserWindow } = require('electron');
const rootArg = process.argv.find((a) => a.startsWith('--app-root='));
const root = rootArg ? path.resolve(rootArg.slice('--app-root='.length)) : path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-smoke-'));
app.setPath('userData', temp);
app.setName('ChapterOne Smoke');
app.disableHardwareAcceleration();

const cli = require(path.join(root, 'src/main/cli'));
let providerReady = false;
cli.checkPrerequisites = async () => ({ node: { found: true }, npm: { found: false },
  claude: { found: providerReady }, codex: { found: false }, gemini: { found: false }, grok: { found: false }, chain: ['claude'] });
const engine = { id: 'smoke', model: '', async checkAuth() { return { ok: true, detail: 'Offline test provider' }; }, async complete(prompt) {
  if (/A reader has asked for a book/.test(prompt)) return JSON.stringify({ needsClarification: true,
    questions: [{ id: 'setting', question: 'Where does the story begin?', suggestions: ['By the river', 'At home'] }] });
  if (/market-ready book/.test(prompt)) return JSON.stringify({ title: 'Smoke Test Book', author: 'Test Author',
    premise: 'A test book.', chapters: [{ title: 'Opening', summary: 'A beginning.' },
      ...(providerReady ? [{ title: 'Home Again', summary: 'The boat returns.' }] : [])] });
  if (/WRITE CHAPTER/.test(prompt)) return '# Opening\n\n' + 'The river carried the little boat home. '.repeat(40);
  return '{}';
} };
cli.createEngine = cli.createChainEngine = () => engine;

const errors = [];
const windowReady = new Promise((resolve) => app.once('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (_event, details, legacyMessage) => {
    const level = typeof details === 'object' ? details.level : details;
    if (level === 'error' || level === 3) errors.push(typeof details === 'object' ? details.message : legacyMessage);
  });
  win.webContents.once('did-finish-load', () => resolve(win));
}));
const deadline = setTimeout(() => { console.error('Smoke test timed out.'); app.exit(1); }, 180000);
require(path.join(root, 'src/main/main.js'));

(async () => {
  const win = await windowReady;
  if (process.argv.includes('--fail-smoke')) throw new Error('Intentional smoke failure');
  const js = (source) => win.webContents.executeJavaScript(source);
  assert.equal(await js('typeof window.api.getSettings'), 'function');
  assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
  await js('window.api.saveSettings({research:false, polish:false})');
  const result = await js(`window.api.generate({request:'A river adventure',research:false,polish:false,imageMode:'off'}, {}, 'smoke-job')`);
  assert.ok(result.id);
  const book = await js(`window.api.getBook(${JSON.stringify(result.id)})`);
  assert.equal(book.status, 'complete');
  assert.equal(book.chapters.length, 1);
  for (const view of ['settings', 'kids', 'create', 'library']) {
    await js(`document.querySelector('[data-view="${view}"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(await js('document.querySelector("#view-root").textContent.length > 50'));
  }
  for (const format of ['epub', 'docx', 'html', 'markdown', 'pdf', 'pdf-print']) {
    const out = await js(`window.api.exportBook(${JSON.stringify(result.id)}, ${JSON.stringify(format)}, false)`);
    assert.ok(fs.statSync(out.path).size > 100, `${format} export should contain data`);
    if (format === 'pdf-print') {
      assert.match(fs.readFileSync(out.path).toString('latin1'), /\/MediaBox\s*\[\s*0\s+0\s+432\s+648\s*\]/);
    }
  }
  const raster = require(path.join(root, 'src/main/export/rasterize'));
  const png = await raster.rasterizeSvg('<svg width="100" height="100"><rect width="100" height="100" fill="red"/></svg>');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await assert.rejects(js('window.api.openPath("/tmp/unapproved.exe")'), /exported document/);
  const untrusted = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, sandbox: true,
  } });
  await untrusted.loadURL('data:text/html,<h1>Untrusted document</h1>');
  await assert.rejects(untrusted.webContents.executeJavaScript('window.api.getSettings()'), /Untrusted IPC/);
  untrusted.destroy();
  await require('./ui-checks.cjs')(win, result.id, () => { providerReady = true; }, () => {
    const { Store } = require(path.join(root, 'src/main/store'));
    const fixtureStore = new Store(temp);
    const original = fixtureStore.getBook(result.id);
    fixtureStore.saveBook({ ...original, id: 'ui-cover-fixture', title: 'The Moonlit Garden', isKids: true, ageBand: '3-5',
      coverSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#233b49"/><circle cx="440" cy="200" r="80" fill="#f0d591"/><path d="M0 620 Q300 420 600 660 L600 900H0Z" fill="#386653"/><text x="60" y="110" fill="#fff" font-size="44">The Moonlit Garden</text><text x="60" y="830" fill="#fff" font-size="26">Test Author</text></svg>' });
    fixtureStore.saveBook({ ...original, id: 'ui-title-fixture', title: 'A Field Guide to Finding Your Way Home When Every Road Leads Somewhere Unexpected', status: 'paused',
      pausedReason: { detail: 'Synthetic paused draft for UI checks.' }, coverSvg: null });
  });
  const artifacts = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, `smoke-${process.platform}-${process.arch}.png`), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'Renderer should not report errors');
  console.log(`Electron smoke passed: ${process.platform}/${process.arch}; UI, IPC, generation, six exports, PDF dimensions, rasterization.`);
})().then(() => finish(0), (error) => { console.error(error); finish(1, error.message); });

function finish(code, error) {
  clearTimeout(deadline);
  // On Windows, destroying the last window invokes main.js's app.quit(), which
  // used to turn failed checks into exit code 0 before the delayed app.exit(1).
  // The Node runner also requires this explicit completion record.
  if (process.env.CHAPTERONE_SMOKE_RESULT) {
    fs.writeFileSync(process.env.CHAPTERONE_SMOKE_RESULT, JSON.stringify({
      ok: code === 0, platform: process.platform, arch: process.arch, root, error,
    }));
  }
  // Electron can hold cache files open until exit on Windows; cleanup is best-effort.
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) { /* OS temp directory */ }
  app.exit(code);
}
