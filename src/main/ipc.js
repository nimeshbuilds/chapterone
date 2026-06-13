'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

const { Store } = require('./store');
const { createEngine, checkPrerequisites } = require('./cli');
const { BookGenerator } = require('./book/generator');
const { generateEpub } = require('./export/epub');
const { generatePdf } = require('./export/pdf');
const { bookToMarkdown } = require('./export/markdown');
const { bookToHtml } = require('./export/html');
const { sendToKindle, verifySmtp } = require('./kindle/sendToKindle');
const { safeFilename } = require('./util');

/**
 * Register all IPC handlers. Returns a small controller for cleanup.
 * @param {Store} store
 */
function registerIpc(store) {
  /** Active generation jobs: jobId -> AbortController */
  const jobs = new Map();

  const wrap = (fn) => async (event, ...args) => {
    try {
      const data = await fn(event, ...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  };

  // ---- settings ----
  ipcMain.handle('settings:get', wrap(async () => store.getSettings()));
  ipcMain.handle('settings:save', wrap(async (_e, partial) => store.saveSettings(partial)));

  // ---- prerequisites ----
  ipcMain.handle('prereq:check', wrap(async () => checkPrerequisites(store.getSettings())));
  ipcMain.handle(
    'prereq:auth',
    wrap(async () => {
      const engine = createEngine(store.getSettings());
      return engine.checkAuth();
    })
  );

  // ---- clarify ----
  ipcMain.handle(
    'book:clarify',
    wrap(async (_e, spec) => {
      const engine = createEngine(store.getSettings());
      const gen = new BookGenerator(engine);
      return gen.clarify(spec);
    })
  );

  // ---- generate (async, streams progress) ----
  ipcMain.handle(
    'book:generate',
    wrap(async (event, { spec, answers, jobId }) => {
      const engine = createEngine(store.getSettings());
      const gen = new BookGenerator(engine);
      const controller = new AbortController();
      jobs.set(jobId, controller);

      const sender = event.sender;
      const onProgress = (e) => {
        if (!sender.isDestroyed()) sender.send('book:progress', { jobId, ...e });
      };
      const onChapter = (book) => {
        store.saveBook(book);
      };

      try {
        const book = await gen.generate(spec, answers || {}, {
          onProgress,
          onChapter,
          signal: controller.signal,
        });
        store.saveBook(book);
        return { id: book.id };
      } finally {
        jobs.delete(jobId);
      }
    })
  );

  ipcMain.handle(
    'book:cancel',
    wrap(async (_e, jobId) => {
      const c = jobs.get(jobId);
      if (c) c.abort();
      return { cancelled: !!c };
    })
  );

  // ---- library ----
  ipcMain.handle('book:list', wrap(async () => store.listBooks()));
  ipcMain.handle('book:get', wrap(async (_e, id) => store.getBook(id)));
  ipcMain.handle('book:delete', wrap(async (_e, id) => {
    store.deleteBook(id);
    return { deleted: true };
  }));
  ipcMain.handle('book:html', wrap(async (_e, id) => bookToHtml(store.getBook(id))));

  // ---- export ----
  ipcMain.handle(
    'book:export',
    wrap(async (_e, { id, format, saveAs }) => {
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
    })
  );

  ipcMain.handle('shell:open', wrap(async (_e, p) => {
    await shell.openPath(p);
    return { opened: true };
  }));
  ipcMain.handle('shell:reveal', wrap(async (_e, p) => {
    shell.showItemInFolder(p);
    return { revealed: true };
  }));

  // ---- kindle ----
  ipcMain.handle('kindle:verify', wrap(async () => {
    const s = store.getSettings();
    return verifySmtp(s.kindle.smtp);
  }));

  ipcMain.handle(
    'kindle:send',
    wrap(async (_e, { id, format }) => {
      const settings = store.getSettings();
      const k = settings.kindle || {};
      const book = store.getBook(id);
      const fmt = format || k.preferredFormat || 'epub';
      const ext = fmt === 'pdf' ? 'pdf' : 'epub';
      const base = safeFilename(book.title, 'book');
      const outPath = path.join(store.exportsDir, `${base}.${ext}`);

      if (ext === 'epub') await generateEpub(book, outPath);
      else await generatePdf(book, outPath);

      const result = await sendToKindle({
        smtp: k.smtp,
        from: k.fromAddress,
        to: k.toAddress,
        filePath: outPath,
        title: book.title,
      });
      return result;
    })
  );

  return {
    dispose() {
      for (const c of jobs.values()) c.abort();
      jobs.clear();
    },
  };
}

module.exports = { registerIpc };
