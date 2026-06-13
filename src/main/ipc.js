'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

const { Store } = require('./store');
const { createEngine, createChainEngine, checkPrerequisites } = require('./cli');
const { modelsFor, providerList, loginFor, PROVIDERS } = require('./cli/models');
const { AuthSessionManager } = require('./cli/authSession');
const { BookGenerator } = require('./book/generator');
const { resolveImagesForBook } = require('./book/images');
const { generateEpub } = require('./export/epub');
const { generatePdf } = require('./export/pdf');
const { bookToMarkdown } = require('./export/markdown');
const { bookToHtml } = require('./export/html');
const { sendToKindle, verifySmtp } = require('./kindle/sendToKindle');
const { safeFilename } = require('./util');

function registerIpc(store) {
  /** Active generation jobs: jobId -> AbortController */
  const jobs = new Map();
  const auth = new AuthSessionManager();

  const wrap = (fn) => async (event, ...args) => {
    try {
      return { ok: true, data: await fn(event, ...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

  /** Build a bwimg-id → data URL resolver from a book's on-disk images. */
  const imageResolver = (book) => {
    const map = new Map();
    for (const im of book.images || []) {
      if (im && im.file && fs.existsSync(im.file)) {
        try {
          const b64 = fs.readFileSync(im.file).toString('base64');
          map.set(im.id, `data:${im.mime || 'image/jpeg'};base64,${b64}`);
        } catch (_) { /* skip */ }
      }
    }
    return (id) => map.get(id) || null;
  };

  /** Run image sourcing for a finished book if the user opted in. */
  const maybeIllustrate = async (book, sender, jobId, signal) => {
    if (!book.spec || !book.spec.illustrate) return book;
    const onProgress = (e) => {
      if (sender && !sender.isDestroyed()) sender.send('book:progress', { jobId, phase: 'images', ...e });
    };
    onProgress({ message: 'Sourcing royalty-free images…' });
    try {
      await resolveImagesForBook(book, { imagesDir: store.imagesDir, onProgress, signal });
      store.saveBook(book);
    } catch (_) { /* non-fatal */ }
    return book;
  };

  // ---- settings & meta ----
  ipcMain.handle('settings:get', wrap(async () => store.getSettings()));
  ipcMain.handle('settings:save', wrap(async (_e, partial) => store.saveSettings(partial)));
  ipcMain.handle('meta:models', wrap(async () => ({
    claude: modelsFor('claude'),
    codex: modelsFor('codex'),
    gemini: modelsFor('gemini'),
    providers: providerList(),
  })));

  // ---- prerequisites ----
  ipcMain.handle('prereq:check', wrap(async () => checkPrerequisites(store.getSettings())));
  ipcMain.handle('prereq:auth', wrap(async (_e, provider) => {
    const settings = store.getSettings();
    const s = provider ? { ...settings, provider } : settings;
    return createEngine(s).checkAuth();
  }));

  // ---- guided sign-in (interactive login) ----
  ipcMain.handle('auth:start', wrap(async (event, provider) => {
    const settings = store.getSettings();
    const meta = PROVIDERS[provider] || PROVIDERS.claude;
    const command =
      (provider === 'codex' && settings.codexCommand) ||
      (provider === 'gemini' && settings.geminiCommand) ||
      settings.claudeCommand || meta.command;
    const login = loginFor(provider);
    const sender = event.sender;
    const send = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload); };

    const sessionId = auth.start({
      command,
      args: login.args,
      scrubEnv: [], // login must be allowed to write subscription credentials
      onOutput: (text) => send('auth:output', { provider, text }),
      onUrl: (url) => { shell.openExternal(url); send('auth:url', { provider, url }); },
      onClose: async (code) => {
        let authed = false;
        try { authed = (await createEngine({ ...settings, provider }).checkAuth()).ok; } catch (_) { /* ignore */ }
        send('auth:closed', { provider, code, authed });
      },
    });
    return { sessionId, command, args: login.args, hint: login.hint };
  }));
  ipcMain.handle('auth:input', wrap(async (_e, { sessionId, text }) => ({ sent: auth.input(sessionId, text) })));
  ipcMain.handle('auth:cancel', wrap(async (_e, sessionId) => ({ cancelled: auth.cancel(sessionId) })));

  // ---- clarify ----
  ipcMain.handle('book:clarify', wrap(async (_e, spec) => {
    const engine = createEngine(store.getSettings(), { model: spec && spec.model });
    return new BookGenerator(engine).clarify(spec);
  }));

  // ---- generate ----
  ipcMain.handle('book:generate', wrap(async (event, { spec, answers, jobId }) => {
    const settings = store.getSettings();
    const controller = new AbortController();
    jobs.set(jobId, controller);
    const sender = event.sender;
    const onProgress = (e) => { if (!sender.isDestroyed()) sender.send('book:progress', { jobId, ...e }); };
    const engine = createChainEngine(settings, {
      onSwitch: (info) => onProgress({ phase: 'engine:switch', ...info }),
    });
    const gen = new BookGenerator(engine);

    try {
      const book = await gen.generate(spec, answers || {}, {
        onProgress,
        onChapter: (b) => store.saveBook(b),
        signal: controller.signal,
      });
      await maybeIllustrate(book, sender, jobId, controller.signal);
      store.saveBook(book);
      return { id: book.id };
    } finally {
      jobs.delete(jobId);
    }
  }));

  // ---- resume a paused / interrupted book ----
  ipcMain.handle('book:resume', wrap(async (event, { id, jobId }) => {
    const settings = store.getSettings();
    const book = store.getBook(id);
    const controller = new AbortController();
    jobs.set(jobId, controller);
    const sender = event.sender;
    const onProgress = (e) => { if (!sender.isDestroyed()) sender.send('book:progress', { jobId, ...e }); };
    const engine = createChainEngine(settings, {
      onSwitch: (info) => onProgress({ phase: 'engine:switch', ...info }),
    });
    const gen = new BookGenerator(engine);

    try {
      const done = await gen.resume(book, {
        onProgress,
        onChapter: (b) => store.saveBook(b),
        signal: controller.signal,
      });
      await maybeIllustrate(done, sender, jobId, controller.signal);
      store.saveBook(done);
      return { id: done.id };
    } finally {
      jobs.delete(jobId);
    }
  }));

  ipcMain.handle('book:cancel', wrap(async (_e, jobId) => {
    const c = jobs.get(jobId);
    if (c) c.abort();
    return { cancelled: !!c };
  }));

  // ---- library ----
  ipcMain.handle('book:list', wrap(async () => store.listBooks()));
  ipcMain.handle('book:get', wrap(async (_e, id) => store.getBook(id)));
  ipcMain.handle('book:delete', wrap(async (_e, id) => { store.deleteBook(id); return { deleted: true }; }));
  ipcMain.handle('book:html', wrap(async (_e, id) => {
    const book = store.getBook(id);
    return bookToHtml(book, { resolveImage: imageResolver(book) });
  }));

  // ---- export ----
  ipcMain.handle('book:export', wrap(async (_e, { id, format, saveAs }) => {
    const book = store.getBook(id);
    const base = safeFilename(book.title, 'book');
    const ext = format === 'pdf' ? 'pdf' : format === 'markdown' ? 'md' : 'epub';
    let outPath;
    if (saveAs) {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win, {
        title: 'Export book',
        defaultPath: `${base}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (result.canceled) return { canceled: true };
      outPath = result.filePath;
    } else {
      outPath = path.join(store.exportsDir, `${base}.${ext}`);
    }
    if (ext === 'epub') await generateEpub(book, outPath);
    else if (ext === 'pdf') await generatePdf(book, outPath);
    else fs.writeFileSync(outPath, bookToMarkdown(book));
    return { path: outPath };
  }));

  ipcMain.handle('shell:open', wrap(async (_e, p) => { await shell.openPath(p); return { opened: true }; }));
  ipcMain.handle('shell:reveal', wrap(async (_e, p) => { shell.showItemInFolder(p); return { revealed: true }; }));

  // ---- kindle ----
  ipcMain.handle('kindle:verify', wrap(async () => verifySmtp(store.getSettings().kindle.smtp)));
  ipcMain.handle('kindle:send', wrap(async (_e, { id, format }) => {
    const k = store.getSettings().kindle || {};
    const book = store.getBook(id);
    const fmt = format || k.preferredFormat || 'epub';
    const ext = fmt === 'pdf' ? 'pdf' : 'epub';
    const outPath = path.join(store.exportsDir, `${safeFilename(book.title, 'book')}.${ext}`);
    if (ext === 'epub') await generateEpub(book, outPath);
    else await generatePdf(book, outPath);
    return sendToKindle({ smtp: k.smtp, from: k.fromAddress, to: k.toAddress, filePath: outPath, title: book.title });
  }));

  return {
    dispose() {
      for (const c of jobs.values()) c.abort();
      jobs.clear();
      auth.disposeAll();
    },
  };
}

module.exports = { registerIpc };
