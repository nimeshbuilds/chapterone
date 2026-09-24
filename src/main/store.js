'use strict';

const fs = require('fs');
const path = require('path');
const { classifyBook } = require('./book/classify');
const { MODEL_PRESETS } = require('./cli/models');
const { DEFAULT_IMAGE_MODEL } = require('./book/nanoBanana');
const revisions = require('./book/revisions');

const SECRET_PATHS = [
  ['geminiApiKey'], ['images', 'geminiApiKey'], ['audio', 'elevenApiKey'],
  ['kindle', 'smtp', 'pass'],
];

/**
 * Tiny JSON-file persistence for settings and the book library.
 * Avoids native/ESM dependencies so it works everywhere Electron does.
 */
class Store {
  constructor(baseDir, { secretStorage } = {}) {
    this.secretStorage = secretStorage;
    this.baseDir = baseDir;
    this.booksDir = path.join(baseDir, 'books');
    this.exportsDir = path.join(baseDir, 'exports');
    this.imagesDir = path.join(baseDir, 'images');
    this.audioDir = path.join(baseDir, 'audio');
    this.settingsPath = path.join(baseDir, 'settings.json');
    fs.mkdirSync(this.booksDir, { recursive: true });
    fs.mkdirSync(this.exportsDir, { recursive: true });
    fs.mkdirSync(this.imagesDir, { recursive: true });
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  /**
   * Write JSON atomically: serialize, write + fsync a temp file in the same
   * directory, then rename over the target (atomic on the same filesystem on
   * both macOS and Windows). A crash or power loss mid-write can therefore
   * never truncate a book or settings.json — saveBook runs after EVERY chapter
   * of a multi-hour generation, so this window used to be wide open.
   */
  _writeJsonAtomic(finalPath, obj) {
    const tmp = `${finalPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const data = JSON.stringify(obj, null, 2);
    let fd = null;
    try {
      fd = fs.openSync(tmp, 'w', 0o600);
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, finalPath);
    } catch (err) {
      if (fd != null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      throw err;
    }
  }

  // ---- settings ----

  defaultSettings() {
    return {
      provider: 'claude', // primary: 'claude' | 'codex' | 'gemini'
      chain: ['claude'], // ordered automated fallback chain
      claudeCommand: 'claude',
      claudeModel: '', // empty => CLI default
      codexCommand: 'codex',
      codexModel: '',
      geminiCommand: 'gemini',
      geminiModel: MODEL_PRESETS.gemini.default,
      grokCommand: 'grok',
      grokModel: MODEL_PRESETS.grok.default,
      forceSubscription: true, // strip API-key env vars; use subscription login
      authorName: '', // if set, books are authored under this name (no invented pen name)
      research: true, // ground content with web search by default
      size: 'medium', // small | medium | large
      imageMode: 'off', // 'off' | 'ai' (CLI-designed SVG art) | 'stock' (Openverse)
      illustrate: false, // legacy flag (mapped to imageMode='stock')
      polish: true, // agentic editor pass for bestseller-grade prose
      // Gemini API key shared by optional image generation and Gemini writing.
      images: {
        provider: 'nano',
        geminiApiKey: '',
        model: DEFAULT_IMAGE_MODEL,
      },
      // ElevenLabs audiobook narration (opt-in, audio-only API key — separate
      // from the CLI subscription and the image key; never used for text).
      audio: {
        elevenApiKey: '',
        model: 'eleven_multilingual_v2',
        voiceId: '',      // default narrator
        voiceIdKids: '',  // narrator used for kids books
      },
      pdfEmailTo: '', // remembered recipient for "Email as PDF"
      kindle: {
        method: 'mail', // 'mail' = hand off to the Mail app (no setup) | 'smtp' = auto-send
        toAddress: '', // <name>@kindle.com
        fromAddress: '',
        smtp: { host: '', port: 587, secure: false, user: '', pass: '' },
        preferredFormat: 'epub', // epub | pdf
      },
    };
  }

  getSettings() {
    // Settings hold the user's API keys and SMTP credentials — never let a
    // corrupt file silently reset them. Try the live file, then the .bak.
    let failure;
    for (const p of [this.settingsPath, this.settingsPath + '.bak']) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const s = deepMerge(this.defaultSettings(), this._secrets(JSON.parse(raw), false));
        // Stock photos retired (a small CC pool, rarely relevant for book scenes).
        // Fall back to the always-relevant, free AI vector art instead.
        if (s.imageMode === 'stock') s.imageMode = 'ai';
        if (s.illustrate) s.illustrate = false;
        return s;
      } catch (error) { if (error.code !== 'ENOENT') failure = error; }
    }
    if (failure) throw new Error(`Could not read saved settings. Your files have been preserved: ${failure.message}`);
    return this.defaultSettings();
  }

  saveSettings(partial) {
    const previous = this.getSettings();
    const merged = deepMerge(previous, partial || {});
    const encoded = this._secrets(merged, true);
    // Back up decoded, validated settings: never copy a corrupt primary over a
    // good fallback, and never retain a legacy plaintext credential backup.
    this._writeJsonAtomic(this.settingsPath + '.bak', this._secrets(previous, true));
    this._writeJsonAtomic(this.settingsPath, encoded);
    return merged;
  }

  _secrets(settings, encrypt) {
    const result = structuredClone(settings);
    for (const keys of SECRET_PATHS) {
      const parent = keys.slice(0, -1).reduce((v, k) => v && v[k], result);
      const key = keys[keys.length - 1];
      if (!parent || !parent[key]) continue;
      const value = parent[key];
      if (!encrypt && typeof value === 'object' && value.encrypted) {
        if (!this.secretStorage?.isEncryptionAvailable()) throw new Error('Unlock the OS credential store to read saved keys.');
        parent[key] = this.secretStorage.decryptString(Buffer.from(value.encrypted, 'base64'));
      } else if (encrypt && typeof value === 'string' && this.secretStorage) {
        if (!this.secretStorage.isEncryptionAvailable()
          || this.secretStorage.getSelectedStorageBackend?.() === 'basic_text') {
          throw new Error('Secure credential storage is unavailable. Unlock the OS credential store before saving keys.');
        }
        parent[key] = { encrypted: this.secretStorage.encryptString(value).toString('base64') };
      }
    }
    return result;
  }

  /** Upgrade existing plaintext credentials in both files without changing values. */
  migrateSecrets() {
    if (!this.secretStorage) return;
    for (const file of [this.settingsPath, this.settingsPath + '.bak']) {
      if (!fs.existsSync(file)) continue;
      let settings;
      try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (_) { continue; } // getSettings can recover from the other file
      this._writeJsonAtomic(file, this._secrets(this._secrets(settings, false), true));
    }
  }

  // ---- books ----

  bookPath(id) {
    // ids are UUIDs we minted; reject anything else so a compromised renderer
    // can't traverse paths (e.g. id = "../../settings") via the IPC surface.
    if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid book id');
    return path.join(this.booksDir, `${id}.json`);
  }

  saveBook(book) {
    book.updatedAt = new Date().toISOString();
    this._writeJsonAtomic(this.bookPath(book.id), book);
    return book;
  }

  getBook(id) {
    return JSON.parse(fs.readFileSync(this.bookPath(id), 'utf8'));
  }

  updateChapter(id, index, content) {
    const book = this.getBook(id);
    const changed = revisions.updateChapterContent(book, index, content);
    if (changed) this.saveBook(book);
    return { id, index, words: revisions.chapterAt(book, index).words, changed };
  }

  /** Commit new prose and its previous version in the same atomic book write. */
  saveRewrittenChapter(book, index, previous) {
    const changed = revisions.recordChapterRevision(book, index, previous, 'ai-rewrite');
    if (changed) {
      revisions.chapterAt(book, index).words = (book.chapters[index].content.match(/\S+/g) || []).length;
      revisions.recountBook(book);
      this.saveBook(book);
    }
    return { id: book.id, index, words: revisions.chapterAt(book, index).words, changed };
  }

  getChapterRevisions(id, index) {
    return revisions.listChapterRevisions(this.getBook(id), index);
  }

  getChapterRevision(id, index, revisionId) {
    return revisions.getChapterRevision(this.getBook(id), index, revisionId);
  }

  restoreChapterRevision(id, index, revisionId) {
    const book = this.getBook(id);
    const changed = revisions.restoreChapterRevision(book, index, revisionId);
    if (changed) this.saveBook(book);
    return { id, index, words: revisions.chapterAt(book, index).words, changed };
  }

  deleteBook(id) {
    fs.rmSync(this.bookPath(id), { force: true });
    for (const dir of [this.imagesDir, this.audioDir]) {
      fs.rmSync(path.join(dir, id), { recursive: true, force: true });
    }
  }

  /**
   * On startup, recover books that aren't really finished:
   *  - status 'generating' → the writing job died when the app closed.
   *  - status 'complete' but a chapter is a near-empty stub (e.g. the CLI hit a
   *    usage limit and returned only a heading) or chapters are missing.
   * Flip them to 'paused' so the UI offers "Continue" and never claims a
   * half-written book is complete.
   */
  reconcileInterrupted() {
    // A short manual edit (including intentionally clearing a chapter) is not
    // a failed model response. Preserve it and its history across restarts;
    // Manuscript check can flag missing prose without destroying user work.
    const generatedStub = (chapter) => chapter && !Object.hasOwn(chapter, 'revisions')
      && (chapter.words || 0) < 15 && (chapter.content || '').length < 200;
    let files;
    try { files = fs.readdirSync(this.booksDir).filter((f) => f.endsWith('.json')); } catch (_) { return; }
    for (const f of files) {
      try {
        const p = path.join(this.booksDir, f);
        const b = JSON.parse(fs.readFileSync(p, 'utf8'));
        let reason = null;
        if (b.status === 'generating') {
          reason = { kind: 'interrupted', detail: 'Writing was interrupted. Click Continue to finish the book.' };
        } else if (b.status === 'complete') {
          const chs = (b.chapters || []).filter(Boolean);
          const planned = (b.outline || []).length;
          const stub = chs.find(generatedStub);
          if (stub) reason = { kind: 'short-chapter', detail: `Chapter ${stub.number} came back almost empty — click Continue to rewrite it.` };
          else if (planned && chs.length < planned) reason = { kind: 'incomplete', detail: `Only ${chs.length} of ${planned} chapters were written. Click Continue to finish.` };
        }
        if (reason) {
          // Drop trailing stub chapters so resume rewrites them from that point.
          if (Array.isArray(b.chapters)) {
            while (b.chapters.length && generatedStub(b.chapters[b.chapters.length - 1])) {
              b.chapters.pop();
            }
          }
          b.status = 'paused';
          b.pausedReason = { ...reason, message: reason.detail, resumable: true, at: new Date().toISOString() };
          b.words = (b.chapters || []).reduce((n, c) => n + ((c && c.words) || 0), 0);
          b.updatedAt = new Date().toISOString();
          this._writeJsonAtomic(p, b);
        }
      } catch (_) { /* skip corrupt */ }
    }
  }

  /**
   * Wipe EVERY local artifact this app created: all books, all generated images
   * and AI art, all cached/exported audio, all exports, and settings.json (which
   * holds the user's API keys and Kindle/SMTP config). The empty data folders are
   * recreated so the app keeps working as if freshly installed. This does NOT
   * touch anything outside this app's data dir — e.g. cloned voices that live on
   * ElevenLabs' servers, CLI sign-ins, or files the user exported elsewhere.
   * @returns {{books:number, images:number, audio:number, exports:number, settings:boolean}}
   */
  clearAllData() {
    const countFiles = (dir) => { try { return fs.readdirSync(dir).length; } catch (_) { return 0; } };
    const summary = {
      books: countFiles(this.booksDir),
      images: countFiles(this.imagesDir),
      audio: countFiles(this.audioDir),
      exports: countFiles(this.exportsDir),
      settings: fs.existsSync(this.settingsPath),
    };
    for (const dir of [this.booksDir, this.imagesDir, this.audioDir, this.exportsDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
    for (const name of fs.readdirSync(this.baseDir)) {
      if (name === 'settings.json' || name === 'settings.json.bak'
        || /^settings\.json\..*\.tmp$/.test(name)) {
        fs.rmSync(path.join(this.baseDir, name), { force: true });
      }
    }
    return summary;
  }

  listBooks() {
    let files;
    try {
      files = fs.readdirSync(this.booksDir).filter((f) => f.endsWith('.json'));
    } catch (_) {
      return [];
    }
    const books = [];
    for (const f of files) {
      try {
        const b = JSON.parse(fs.readFileSync(path.join(this.booksDir, f), 'utf8'));
        books.push({
          id: b.id,
          title: b.title,
          subtitle: b.subtitle,
          author: b.author,
          genre: b.genre,
          status: b.status,
          pausedReason: b.pausedReason || null,
          words: b.words || (b.chapters || []).filter(Boolean).reduce((n, c) => n + (c.words || 0), 0),
          chapters: (b.chapters || []).filter(Boolean).length,
          plannedChapters: (b.outline || []).length,
          cover: coverDataUri(b),
          classification: classifyBook(b), // industry-standard audience/format label
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        });
      } catch (_) {
        /* skip corrupt */
      }
    }
    books.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return books;
  }
}

/** Cover as a data URI for library cards: rasterized PNG if present, else SVG. */
function coverDataUri(b) {
  try {
    if (b.coverPng && fs.existsSync(b.coverPng)) {
      return 'data:image/png;base64,' + fs.readFileSync(b.coverPng).toString('base64');
    }
  } catch (_) { /* fall through */ }
  if (b.coverSvg) return 'data:image/svg+xml;base64,' + Buffer.from(b.coverSvg, 'utf8').toString('base64');
  return null;
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (override && typeof override === 'object') {
    const out = { ...base };
    for (const k of Object.keys(override)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k)) continue;
      if (
        override[k] &&
        typeof override[k] === 'object' &&
        !Array.isArray(override[k]) &&
        base &&
        typeof base[k] === 'object'
      ) {
        out[k] = deepMerge(base[k], override[k]);
      } else {
        out[k] = override[k];
      }
    }
    return out;
  }
  return override === undefined ? base : override;
}

module.exports = { Store, deepMerge };
