'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

/** Open the user's terminal running `cmd` (real PTY for interactive CLI login). */
function openLoginTerminal(cmd) {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      const esc = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execFile('osascript', ['-e', `tell application "Terminal"\nactivate\ndo script "${esc}"\nend tell`], (err) => resolve(!err));
    } else if (process.platform === 'win32') {
      try { execFile('cmd', ['/c', 'start', 'cmd', '/k', cmd]); resolve(true); } catch (_) { resolve(false); }
    } else {
      const term = process.env.TERMINAL || 'x-terminal-emulator';
      try { execFile(term, ['-e', cmd]); resolve(true); } catch (_) { resolve(false); }
    }
  });
}

const { Store } = require('./store');
const { createEngine, createChainEngine, checkPrerequisites, installProviderCli, verifyModel } = require('./cli');
const { modelsFor, providerList, loginFor, PROVIDERS } = require('./cli/models');
const { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, verifyKey, priceFor, modelLabel } = require('./book/nanoBanana');
const { bandOf, plannedImageCount, readerVarsForBand } = require('./book/ageBands');
const elevenlabs = require('./book/elevenlabs');
const { markdownToSpeech, tidyText } = require('./book/typography');
const { AuthSessionManager } = require('./cli/authSession');
const { BookGenerator } = require('./book/generator');
const { resolveImagesForBook } = require('./book/images');
const { generateEpub } = require('./export/epub');
const { generatePdf } = require('./export/pdf');
const { rasterizeBookArt } = require('./export/rasterize');
const { bookToMarkdown } = require('./export/markdown');
const { bookToHtml, chapterToHtml, svgFigure } = require('./export/html');
const { svgToDataUri } = require('./book/aiArt');
const { sendToKindle, sendEmailWithAttachment, verifySmtp, composeInMail, SIGNATURE } = require('./kindle/sendToKindle');
const { safeFilename } = require('./util');

function registerIpc(store) {
  /** Active generation jobs: jobId -> AbortController */
  const jobs = new Map();
  const auth = new AuthSessionManager();

  /** Image (Nano Banana) config from settings, for the generator. */
  const imageConfigFrom = (settings) => {
    const imgs = settings.images || {};
    return { apiKey: imgs.geminiApiKey || '', model: imgs.model || DEFAULT_IMAGE_MODEL, imagesDir: store.imagesDir };
  };

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

  const fileDataUri = (file, mime) => {
    try { return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`; }
    catch (_) { return null; }
  };
  /** Best available image source for cover/art: rasterized PNG, else the SVG. */
  const coverUri = (book) =>
    (book.coverPng && fs.existsSync(book.coverPng) && fileDataUri(book.coverPng, 'image/png')) ||
    (book.coverSvg ? svgToDataUri(book.coverSvg) : null);
  const chapterArtUri = (c) =>
    (c.artFile && fs.existsSync(c.artFile) && fileDataUri(c.artFile, 'image/png')) ||
    (c.artSvg ? svgToDataUri(c.artSvg) : null);

  /** Rasterize AI-designed art (hybrid HTML or SVG) to PNG so it displays everywhere. */
  const maybeRasterize = async (book) => {
    const hasArt = book.coverSvg || book.coverHtml
      || (book.chapters || []).some((c) => c && (c.artSvg || c.artHtml));
    if (!hasArt) return book;
    try {
      await rasterizeBookArt(book, store.imagesDir);
      store.saveBook(book);
    } catch (_) { /* SVG fallback remains */ }
    return book;
  };

  /** Run image sourcing for a finished book if the user opted in. */
  const maybeIllustrate = async (book, sender, jobId, signal) => {
    const mode = book.spec && (book.spec.imageMode || (book.spec.illustrate ? 'stock' : 'off'));
    if (mode !== 'stock') return book; // AI art is generated inline by the writer
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
  // Danger zone: erase every local artifact (books, images, audio, exports, keys).
  ipcMain.handle('data:clear', wrap(async () => store.clearAllData()));
  ipcMain.handle('meta:models', wrap(async () => ({
    claude: modelsFor('claude'),
    codex: modelsFor('codex'),
    gemini: modelsFor('gemini'),
    grok: modelsFor('grok'),
    providers: providerList(),
    imageModels: IMAGE_MODELS,
    defaultImageModel: DEFAULT_IMAGE_MODEL,
    audioModels: elevenlabs.MODELS,
  })));

  // ---- Nano Banana images ----
  ipcMain.handle('images:verify', wrap(async () => {
    const imgs = store.getSettings().images || {};
    return verifyKey(imgs.geminiApiKey, imgs.model || DEFAULT_IMAGE_MODEL);
  }));
  // Estimate image count + USD cost for a spec, BEFORE generation starts.
  ipcMain.handle('images:estimate', wrap(async (_e, spec = {}) => {
    const model = (store.getSettings().images || {}).model || DEFAULT_IMAGE_MODEL;
    const band = bandOf(spec);
    let count = 1; // cover
    if (band) count += plannedImageCount(band, spec.kidsLength);
    else {
      // Adult/general Nano: ~1 per chapter; estimate from requested size.
      const { sizeOf } = require('./book/prompts');
      count += sizeOf(spec).maxCh;
    }
    return { count, perImage: priceFor(model), cost: +(count * priceFor(model)).toFixed(2), model, modelLabel: modelLabel(model), approximate: !band };
  }));

  // ---- Audiobook (ElevenLabs) ----
  ipcMain.handle('audio:voices', wrap(async () => {
    const a = store.getSettings().audio || {};
    const voices = await elevenlabs.listVoices(a.elevenApiKey);
    const adult = elevenlabs.RECOMMENDED.adults.map((n) => n.toLowerCase());
    const kids = elevenlabs.RECOMMENDED.kids.map((n) => n.toLowerCase());
    return voices.map((v) => ({
      voice_id: v.voice_id, name: v.name, category: v.category, preview_url: v.preview_url,
      recAdult: adult.some((n) => (v.name || '').toLowerCase().includes(n)),
      recKids: kids.some((n) => (v.name || '').toLowerCase().includes(n)),
    }));
  }));
  ipcMain.handle('audio:verify', wrap(async () => elevenlabs.verifyKey((store.getSettings().audio || {}).elevenApiKey)));

  // Synthesize a chapter to an on-disk MP3 (cached), returning its path. The
  // cache key includes voice + model, so the API is called only once per
  // (chapter, voice, model) — re-listens load instantly from disk, no charge.
  const synthChapterToFile = async (id, index, opts = {}) => {
    const a = store.getSettings().audio || {};
    const book = store.getBook(id);
    const ch = (book.chapters || []).filter(Boolean)[index];
    if (!ch) throw new Error('That chapter has not been written yet.');
    // The voice can be overridden per chapter (the reader's voice picker);
    // otherwise the book-appropriate default. Cache key includes voice + model.
    const voiceId = opts.voiceId || (book.isKids && a.voiceIdKids ? a.voiceIdKids : a.voiceId);
    if (!voiceId) throw new Error('Pick a narration voice first.');
    const model = a.model || elevenlabs.DEFAULT_MODEL;
    const dir = path.join(store.audioDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `ch${ch.number}-${voiceId}-${model}.mp3`);
    if (opts.force && fs.existsSync(file)) { try { fs.unlinkSync(file); } catch (_) { /* ignore */ } }
    const cached = fs.existsSync(file);
    if (!cached) {
      const { buffer } = await elevenlabs.tts({
        apiKey: a.elevenApiKey, voiceId, modelId: model,
        text: markdownToSpeech(ch.content), signal: opts.signal, onProgress: opts.onProgress,
      });
      fs.writeFileSync(file, buffer);
    }
    return { file, title: ch.title, number: ch.number, cached, voiceId };
  };

  ipcMain.handle('audio:synth', wrap(async (event, { id, index, voiceId, force }) => {
    const sender = event.sender;
    const onProgress = (p) => { if (!sender.isDestroyed()) sender.send('audio:progress', { id, index, ...p }); };
    const r = await synthChapterToFile(id, index, { onProgress, voiceId, force });
    return { dataUri: 'data:audio/mpeg;base64,' + fs.readFileSync(r.file).toString('base64'), title: r.title, number: r.number, cached: r.cached };
  }));

  // Clone the user's own voice from recorded/uploaded samples.
  ipcMain.handle('audio:clone', wrap(async (_e, { name, samples }) => {
    const a = store.getSettings().audio || {};
    const decoded = (samples || []).map((s, i) => {
      // MediaRecorder produces "data:audio/webm;codecs=opus;base64,…"; decodeDataUri
      // tolerates the media-type parameters that the old inline regex broke on.
      const { buffer, mime, ext } = elevenlabs.decodeDataUri(s.dataUri);
      return { buffer, mime, filename: s.filename || `sample-${i + 1}.${ext}` };
    });
    const voice = await elevenlabs.cloneVoice({ apiKey: a.elevenApiKey, name, samples: decoded });
    store.saveSettings({ audio: { voiceId: voice.voice_id } }); // use the cloned voice by default
    return voice;
  }));

  ipcMain.handle('audio:export', wrap(async (_e, { id, index, voiceId }) => {
    const { file, title } = await synthChapterToFile(id, index, { voiceId });
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      title: 'Save chapter audio', defaultPath: `${safeFilename(title, 'chapter')}.mp3`,
      filters: [{ name: 'MP3', extensions: ['mp3'] }],
    });
    if (result.canceled) return { canceled: true };
    fs.copyFileSync(file, result.filePath);
    return { path: result.filePath };
  }));

  // Which chapters of a book are already narrated (cached) for a given voice, so
  // the UI knows whether the whole-book audio is ready and where to resume.
  const audiobookStatus = (id, voiceId) => {
    const a = store.getSettings().audio || {};
    const book = store.getBook(id);
    const chapters = (book.chapters || []).filter(Boolean);
    const vid = voiceId || (book.isKids && a.voiceIdKids ? a.voiceIdKids : a.voiceId);
    const model = a.model || elevenlabs.DEFAULT_MODEL;
    const dir = path.join(store.audioDir, id);
    const list = chapters.map((ch, idx) => ({
      index: idx, number: ch.number, title: ch.title,
      cached: !!(vid && fs.existsSync(path.join(dir, `ch${ch.number}-${vid}-${model}.mp3`))),
    }));
    const have = list.filter((c) => c.cached).length;
    return { total: chapters.length, have, complete: chapters.length > 0 && have === chapters.length, voiceId: vid, model, chapters: list };
  };
  ipcMain.handle('audio:status', wrap(async (_e, { id, voiceId }) => audiobookStatus(id, voiceId)));

  // Narrate the WHOLE book — every chapter, in order — caching each one
  // individually (so chapter-by-chapter listening still works and progress is
  // never lost). Cache-aware: already-narrated chapters are skipped for free.
  // Resumable: one chapter failing (e.g. a transient ElevenLabs error) is
  // retried once, then recorded and skipped so the rest still get done.
  ipcMain.handle('audio:generate-all', wrap(async (event, { id, voiceId }) => {
    const book = store.getBook(id);
    const chapters = (book.chapters || []).filter(Boolean);
    if (!chapters.length) throw new Error('This book has no chapters yet.');
    const sender = event.sender;
    const tell = (p) => { if (!sender.isDestroyed()) sender.send('audio:full-progress', { id, total: chapters.length, ...p }); };

    let narrated = 0, fromCache = 0;
    const failed = [];
    for (let i = 0; i < chapters.length; i++) {
      tell({ phase: 'chapter', index: i, done: i, title: chapters[i].title });
      let ok = false, lastErr = null;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const r = await synthChapterToFile(id, i, {
            voiceId,
            onProgress: (c) => tell({ phase: 'chunk', index: i, done: i, title: chapters[i].title, chunk: c }),
          });
          if (r.cached) fromCache++; else narrated++;
          ok = true;
        } catch (e) { lastErr = e; }
      }
      if (!ok) failed.push({ number: chapters[i].number, title: chapters[i].title, error: (lastErr && lastErr.message) || 'unknown error' });
    }
    tell({ phase: 'complete', done: chapters.length });
    return { total: chapters.length, narrated, fromCache, failed };
  }));

  // Optional: stitch the (already-cached) chapters into one MP3 file on disk —
  // for sideloading to a phone/Kindle. Narrates any missing chapters first.
  ipcMain.handle('audio:full', wrap(async (event, { id, voiceId }) => {
    const book = store.getBook(id);
    const chapters = (book.chapters || []).filter(Boolean);
    if (!chapters.length) throw new Error('This book has no chapters yet.');
    const sender = event.sender;
    const tell = (p) => { if (!sender.isDestroyed()) sender.send('audio:full-progress', { id, total: chapters.length, ...p }); };

    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      title: 'Save audiobook', defaultPath: `${safeFilename(book.title, 'audiobook')}.mp3`,
      filters: [{ name: 'MP3', extensions: ['mp3'] }],
    });
    if (result.canceled) return { canceled: true };

    const parts = [];
    for (let i = 0; i < chapters.length; i++) {
      tell({ phase: 'chapter', index: i, done: i, title: chapters[i].title });
      const { file } = await synthChapterToFile(id, i, {
        voiceId,
        onProgress: (c) => tell({ phase: 'chunk', index: i, done: i, chunk: c }),
      });
      parts.push(fs.readFileSync(file));
    }
    fs.writeFileSync(result.filePath, Buffer.concat(parts));
    tell({ phase: 'complete', done: chapters.length });
    return { path: result.filePath, chapters: chapters.length };
  }));

  // ---- prerequisites ----
  ipcMain.handle('prereq:check', wrap(async () => checkPrerequisites(store.getSettings())));

  // Sign-in status: probe each INSTALLED CLI (a tiny completion). This is the
  // ground truth for "is this provider actually logged in", shown in the UI.
  ipcMain.handle('prereq:authStatus', wrap(async () => {
    const settings = store.getSettings();
    const pre = await checkPrerequisites(settings);
    const { PROVIDER_IDS } = require('./cli/models');
    const ids = PROVIDER_IDS; // every catalogued engine, incl. grok — never hardcode
    const entries = await Promise.all(ids.map(async (id) => {
      if (!(pre[id] && pre[id].found)) return [id, { installed: false, signedIn: false }];
      try {
        const r = await createEngine({ ...settings, provider: id }).checkAuth();
        return [id, { installed: true, signedIn: !!r.ok, detail: r.detail }];
      } catch (e) {
        return [id, { installed: true, signedIn: false, detail: e.message }];
      }
    }));
    return Object.fromEntries(entries);
  }));

  // ---- one-click CLI install (npm -g), streamed to the renderer ----
  ipcMain.handle('cli:install', wrap(async (event, provider) => {
    const settings = store.getSettings();
    const command = settings[`${provider}Command`];
    const sender = event.sender;
    const onLine = (text) => { if (!sender.isDestroyed()) sender.send('cli:install:output', { provider, text }); };
    return installProviderCli(provider, { command, onLine });
  }));
  ipcMain.handle('model:verify', wrap(async (_e, provider, model) => {
    return verifyModel(provider, model, store.getSettings());
  }));
  ipcMain.handle('prereq:auth', wrap(async (_e, provider) => {
    const settings = store.getSettings();
    const s = provider ? { ...settings, provider } : settings;
    return createEngine(s).checkAuth();
  }));

  // ---- sign-in: open the user's real Terminal running the login command ----
  // These CLIs use an interactive TUI + browser OAuth that needs a real PTY,
  // which a piped child process can't provide. The user completes sign-in in
  // Terminal (writing creds to ~/.claude, ~/.gemini, ~/.codex) and clicks
  // "I've finished" to re-check — the same home dir the app reads.
  ipcMain.handle('auth:start', wrap(async (_e, provider) => {
    const settings = store.getSettings();
    const meta = PROVIDERS[provider] || PROVIDERS.claude;
    const command = settings[`${provider}Command`] || meta.command;
    const login = loginFor(provider);
    const fullCmd = `${command} ${(login.args || []).join(' ')}`.trim();
    const opened = await openLoginTerminal(fullCmd);
    return { opened, command: fullCmd, hint: login.hint };
  }));
  ipcMain.handle('auth:input', wrap(async () => ({ sent: false })));
  ipcMain.handle('auth:cancel', wrap(async () => ({ cancelled: true })));

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
    const gen = new BookGenerator(engine, { imageConfig: imageConfigFrom(settings) });

    try {
      const book = await gen.generate(spec, answers || {}, {
        onProgress,
        onChapter: (b) => store.saveBook(b),
        signal: controller.signal,
      });
      await maybeIllustrate(book, sender, jobId, controller.signal);
      onProgress({ phase: 'rasterize', message: 'Finalizing artwork…' });
      await maybeRasterize(book);
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
    const gen = new BookGenerator(engine, { imageConfig: imageConfigFrom(settings) });

    try {
      const done = await gen.resume(book, {
        onProgress,
        onChapter: (b) => store.saveBook(b),
        signal: controller.signal,
      });
      await maybeIllustrate(done, sender, jobId, controller.signal);
      await maybeRasterize(done);
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
  // Structured content for the built-in EPUB reader: per-chapter HTML with
  // images resolved to data URLs, plus metadata.
  ipcMain.handle('book:content', wrap(async (_e, id) => {
    const book = store.getBook(id);
    const resolve = imageResolver(book);
    return {
      id: book.id,
      title: tidyText(book.title),
      subtitle: tidyText(book.subtitle),
      author: book.author,
      premise: tidyText(book.premise),
      status: book.status,
      ageBand: book.ageBand || '',
      isKids: !!book.isKids,
      readerFontPx: (readerVarsForBand(book.ageBand) || {}).fontPx || null,
      pausedReason: book.pausedReason || null,
      words: book.words || 0,
      cover: coverUri(book),
      images: (book.images || []).map((im) => ({ caption: im.caption, attribution: im.attribution, license: im.license, licenseUrl: im.licenseUrl, landing: im.landing })),
      chapters: (book.chapters || []).filter(Boolean).map((c) => {
        const artUri = chapterArtUri(c);
        const artHtml = artUri ? `<figure class="chapter-art"><img src="${artUri}" alt="" /></figure>` : '';
        return {
          number: c.number,
          title: tidyText(c.title),
          words: c.words || 0,
          html: artHtml + chapterToHtml(c.content, resolve, c.number),
        };
      }),
    };
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

  // ---- delivery ----
  // SMTP is "ready" only when the user opted into it AND filled in credentials.
  const smtpReady = (k) => k && k.method === 'smtp' && k.smtp && k.smtp.host && k.smtp.user && k.smtp.pass && k.fromAddress;
  // Default path: hand the message off to the Mail app (no credentials). On a
  // non-macOS host without SMTP, just save the file and reveal it.
  const handOff = async ({ to, subject, body, filePath }) => {
    try {
      const r = await composeInMail({ to, subject, body, filePath });
      if (r.attached === false) {
        // Mail opened but the file didn't attach — reveal it so the user can drag it in.
        shell.showItemInFolder(filePath);
        return { method: 'mail-noattach', path: filePath };
      }
      return { method: 'mail', path: filePath };
    } catch (err) {
      if (process.platform === 'darwin') throw err;
      shell.showItemInFolder(filePath);
      return { method: 'saved', path: filePath };
    }
  };

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

    const to = (k.toAddress || '').trim();
    if (!to || !/@kindle\.com$/i.test(to)) throw new Error('Add your @kindle.com address in Settings first.');

    if (smtpReady(k)) {
      return sendToKindle({ smtp: k.smtp, from: k.fromAddress, to, filePath: outPath, title: book.title });
    }
    return handOff({ to, subject: book.title, body: `Your book "${book.title}" is attached. ${SIGNATURE}`, filePath: outPath });
  }));

  // ---- export to PDF and email to any address ----
  ipcMain.handle('email:pdf', wrap(async (_e, { id, to }) => {
    const settings = store.getSettings();
    const k = settings.kindle || {};
    const book = store.getBook(id);
    const recipient = (to || '').trim();
    const outPath = path.join(store.exportsDir, `${safeFilename(book.title, 'book')}.pdf`);
    await generatePdf(book, outPath);
    store.saveSettings({ pdfEmailTo: recipient }); // remember the recipient
    const body = `Your book "${book.title}" by ${book.author || 'Anonymous'} is attached as a PDF. ${SIGNATURE}`;

    if (smtpReady(k)) {
      return sendEmailWithAttachment({ smtp: k.smtp, from: k.fromAddress, to: recipient, filePath: outPath, subject: `${book.title} (PDF)`, text: body });
    }
    return handOff({ to: recipient, subject: `${book.title} (PDF)`, body, filePath: outPath });
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
