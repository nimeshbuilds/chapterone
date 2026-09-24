'use strict';

// Runs the real main process, preload, renderer and exports with a synthetic
// provider and an isolated userData directory. No accounts or API calls.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { app, BrowserWindow, dialog } = require('electron');
const rootArg = process.argv.find((a) => a.startsWith('--app-root='));
const root = rootArg ? path.resolve(rootArg.slice('--app-root='.length)) : path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-smoke-'));
app.setPath('userData', temp);
app.setName('ChapterOne Smoke');
app.disableHardwareAcceleration();

const cli = require(path.join(root, 'src/main/cli'));
let providerReady = false;
let heldRewrite = null;
const modelChecks = [];
cli.verifyModel = async (provider, model) => {
  modelChecks.push({ provider, model });
  return { valid: true, detail: 'Offline model check' };
};
cli.checkPrerequisites = async () => ({ node: { found: true }, npm: { found: false },
  claude: { found: providerReady }, codex: { found: false }, gemini: { found: false }, grok: { found: false }, chain: ['claude'] });
const engine = { id: 'smoke', model: '', async checkAuth() { return { ok: true, detail: 'Offline test provider' }; }, async complete(prompt) {
  if (heldRewrite && prompt.includes('CURRENT DRAFT (rewrite it, keep what works)')) {
    heldRewrite.entered.resolve();
    return heldRewrite.result.promise;
  }
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
  await checkManuscriptBackend(js, book, win);
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
  for (const source of [
    `window.api.bookReadiness(${JSON.stringify(result.id)})`,
    `window.api.getChapterRevisions(${JSON.stringify(result.id)},0)`,
    `window.api.getChapterRevision(${JSON.stringify(result.id)},0,'00000000-0000-0000-0000-000000000000')`,
    `window.api.restoreChapterRevision(${JSON.stringify(result.id)},0,'00000000-0000-0000-0000-000000000000')`,
  ]) await assert.rejects(untrusted.webContents.executeJavaScript(source), /Untrusted IPC/);
  untrusted.destroy();
  await require('./ui-checks.cjs')(win, result.id, () => { providerReady = true; }, () => {
    const { Store } = require(path.join(root, 'src/main/store'));
    const fixtureStore = new Store(temp);
    const original = fixtureStore.getBook(result.id);
    fixtureStore.saveBook({ ...original, id: 'ui-cover-fixture', title: 'The Moonlit Garden', isKids: true, ageBand: '3-5',
      coverSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#233b49"/><circle cx="440" cy="200" r="80" fill="#f0d591"/><path d="M0 620 Q300 420 600 660 L600 900H0Z" fill="#386653"/><text x="60" y="110" fill="#fff" font-size="44">The Moonlit Garden</text><text x="60" y="830" fill="#fff" font-size="26">Test Author</text></svg>' });
    fixtureStore.saveBook({ ...original, id: 'ui-title-fixture', title: 'A Field Guide to Finding Your Way Home When Every Road Leads Somewhere Unexpected', status: 'paused',
      pausedReason: { detail: 'Synthetic paused draft for UI checks.' }, coverSvg: null });
  }, modelChecks, {
    holdRewrite() {
      if (heldRewrite) throw new Error('A synthetic rewrite is already held.');
      heldRewrite = { entered: deferred(), result: deferred() };
    },
    awaitRewrite() {
      if (!heldRewrite) throw new Error('Hold a synthetic rewrite before awaiting it.');
      return heldRewrite.entered.promise;
    },
    resolveRewrite(content) {
      if (!heldRewrite) throw new Error('No synthetic rewrite is waiting.');
      const pending = heldRewrite;
      heldRewrite = null;
      pending.result.resolve(content);
    },
  });
  await require('./audio-ui-checks.cjs')(win, root, temp);
  const artifacts = path.join(__dirname, '..', 'artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, `smoke-${process.platform}-${process.arch}.png`), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, [], 'Renderer should not report errors');
  console.log(`Electron smoke passed: ${process.platform}/${process.arch}; UI, IPC, generation, revision persistence/restore/cancellation/guards, manuscript checks, six exports, PDF dimensions, rasterization.`);
})().then(() => finish(0), (error) => { console.error(error); finish(1, error.message); });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** Real preload/IPC/storage checks; only the provider and OS save dialog wait. */
async function checkManuscriptBackend(js, original, win) {
  const { Store } = require(path.join(root, 'src/main/store'));
  const store = new Store(temp);
  const id = 'revision-smoke-fixture';
  const savedProse = '# Opening\n\nOriginal version for local history.\n\n<script>window.__unsafeRevision=true</script><img src="https://example.test/tracker">';
  store.saveBook({ ...original, id, chapters: [{ ...original.chapters[0], content: savedProse }] });
  const invoke = (method, ...args) => js(`window.api.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`);
  for (const name of ['bookReadiness', 'getChapterRevisions', 'getChapterRevision', 'restoreChapterRevision']) {
    assert.equal(await js(`typeof window.api.${name}`), 'function', `${name} must be exposed by the preload`);
  }
  assert.equal((await invoke('getChapterRevisions', id, 0)).revisions.length, 0);
  await invoke('updateChapter', id, 0, '# Opening\n\nTODO: review this draft marker.');
  const first = (await invoke('getChapterRevisions', id, 0)).revisions[0];
  assert.equal(first.content, undefined);
  assert.equal(first.reason, 'manual-edit');
  const preview = await invoke('getChapterRevision', id, 0, first.id);
  assert.equal(preview.content, savedProse);
  assert.doesNotMatch(preview.html, /script|__unsafeRevision|example.test|<img/i);
  const report = await invoke('bookReadiness', id);
  assert.equal(report.status, 'review');
  assert.ok(report.checks.some((check) => check.id === 'draft-marker-0' && check.chapterIndex === 0));
  const currentProse = (await invoke('getBook', id)).chapters[0].content;
  assert.equal((await invoke('updateChapter', id, 0, currentProse)).changed, false);
  assert.equal((await invoke('getChapterRevisions', id, 0)).revisions.length, 1);
  await invoke('restoreChapterRevision', id, 0, first.id);
  assert.equal((await invoke('getBook', id)).chapters[0].content, savedProse);
  const redo = (await invoke('getChapterRevisions', id, 0)).revisions[0];
  assert.equal(redo.reason, 'restore');
  await invoke('restoreChapterRevision', id, 0, redo.id);
  assert.equal((await invoke('getBook', id)).chapters[0].content, currentProse);
  const persisted = store.getBook(id);
  persisted.subtitle = 'Persistence check';
  store.saveBook(persisted);
  const reopened = new Store(temp);
  reopened.reconcileInterrupted();
  assert.equal(reopened.getChapterRevisions(id, 0).revisions.length, 3);
  assert.equal((await invoke('getChapterRevisions', id, 0)).revisions.length, 3);
  await assert.rejects(invoke('getChapterRevisions', '../settings', 0), /Invalid book id/);
  await assert.rejects(invoke('getChapterRevisions', id, '0'), /Invalid chapter index/);
  await assert.rejects(invoke('restoreChapterRevision', id, 0, '../outside'), /Invalid revision id/);

  const before = fs.readFileSync(store.bookPath(id), 'utf8');
  heldRewrite = { entered: deferred(), result: deferred() };
  await js(`window.__revisionPending = window.api.rewriteChapter(${JSON.stringify(id)},0,'Improve the ending.','revision-held-job').then(value=>({ok:true,value}),error=>({ok:false,error:error.message})); true`);
  await heldRewrite.entered.promise;
  await assert.rejects(invoke('restoreChapterRevision', id, 0, first.id), /current writing job/);
  await assert.rejects(invoke('updateChapter', id, 0, 'This must not overwrite the active job.'), /current writing job/);
  await assert.rejects(invoke('exportBook', id, 'markdown', false), /current writing job/);
  await checkWindowCloseProtection(win, js);
  // A cancelled app quit must not dispose the job before the editor can veto.
  assert.equal((await invoke('cancelGeneration', 'revision-held-job')).cancelled, true);
  heldRewrite.result.resolve('# Opening\n\nLate provider response after cancellation.');
  const cancelled = await js('window.__revisionPending');
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /cancelled/);
  assert.equal(fs.readFileSync(store.bookPath(id), 'utf8'), before);
  heldRewrite = { entered: deferred(), result: deferred() };
  await js(`window.__revisionPending = window.api.rewriteChapter(${JSON.stringify(id)},0,'Improve the ending.','revision-success-job').then(value=>({ok:true,value}),error=>({ok:false,error:error.message})); true`);
  await heldRewrite.entered.promise;
  heldRewrite.result.resolve('# Opening\n\nA revised ending brings the boat safely home.');
  assert.equal((await js('window.__revisionPending')).ok, true);
  heldRewrite = null;
  const rewriteHistory = await invoke('getChapterRevisions', id, 0);
  assert.equal(rewriteHistory.revisions[0].reason, 'ai-rewrite');
  assert.equal((await invoke('getChapterRevision', id, 0, rewriteHistory.revisions[0].id)).content, currentProse);

  const enteredDialog = deferred();
  const closeDialog = deferred();
  const originalDialog = dialog.showSaveDialog;
  dialog.showSaveDialog = () => { enteredDialog.resolve(); return closeDialog.promise; };
  try {
    await js(`window.__revisionExport = window.api.exportBook(${JSON.stringify(id)},'markdown',true).then(value=>({ok:true,value}),error=>({ok:false,error:error.message})); true`);
    await enteredDialog.promise;
    await assert.rejects(invoke('restoreChapterRevision', id, 0, first.id), /audio, export, or delivery/);
    await assert.rejects(invoke('updateChapter', id, 0, 'Not while exporting.'), /audio, export, or delivery/);
    closeDialog.resolve({ canceled: true });
    assert.equal((await js('window.__revisionExport')).value.canceled, true);
  } finally {
    closeDialog.resolve({ canceled: true });
    dialog.showSaveDialog = originalDialog;
  }
  for (const format of ['html', 'markdown']) {
    const exported = await invoke('exportBook', id, format, false);
    const contents = fs.readFileSync(exported.path, 'utf8');
    assert.match(contents, /A revised ending/);
    assert.doesNotMatch(contents, /Original version for local history|draft marker|__unsafeRevision/);
  }
  assert.equal((await invoke('bookReadiness', id)).status, 'clear');
  assert.equal((await invoke('restoreChapterRevision', id, 0, first.id)).changed, true);
  await invoke('deleteBook', id);
  assert.equal(fs.existsSync(store.bookPath(id)), false);
  await js('delete window.__revisionPending; delete window.__revisionExport; true');
  console.log('Manuscript backend smoke passed: real preload, sanitized history, exact restore/redo, durable versions, cancellation, writing/export guards, offline checks and export exclusion.');
}

async function checkWindowCloseProtection(win, js) {
  const { protectUnsavedChanges } = require(path.join(root, 'src/main/windowLifecycle'));
  const originalPrompt = dialog.showMessageBoxSync;
  let prompts = 0;
  dialog.showMessageBoxSync = (_parent, options) => {
    prompts++;
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    return 0;
  };
  await js('window.__closeGuard = e => { e.preventDefault(); e.returnValue = ""; }; window.addEventListener("beforeunload", window.__closeGuard); true');
  try {
    const prevented = new Promise(resolve => win.webContents.once('will-prevent-unload', resolve));
    app.quit();
    await prevented;
    assert.equal(win.isDestroyed(), false);
    assert.equal(prompts, 1);
    assert.equal(await js('typeof window.api.getBook'), 'function');
  } finally {
    dialog.showMessageBoxSync = originalPrompt;
    if (!win.isDestroyed()) await js('window.removeEventListener("beforeunload", window.__closeGuard); delete window.__closeGuard; true');
  }
  // Exercise the explicit-discard path on a spare real window, keeping the
  // application window alive for the rest of the UI suite.
  const spare = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  protectUnsavedChanges(spare, { showMessageBoxSync: () => 1 });
  await spare.loadURL('data:text/html,<p>Unsaved close fixture</p>');
  await spare.webContents.executeJavaScript('window.addEventListener("beforeunload",e=>{e.preventDefault();e.returnValue="";}); true');
  const closed = new Promise(resolve => spare.once('closed', resolve));
  spare.close();
  await closed;
  assert.equal(spare.isDestroyed(), true);
  console.log('Window lifecycle smoke passed: cancelled quit preserves the window and writing job; explicit discard closes the spare window.');
}

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
