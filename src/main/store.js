'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON-file persistence for settings and the book library.
 * Avoids native/ESM dependencies so it works everywhere Electron does.
 */
class Store {
  constructor(baseDir) {
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
      geminiModel: 'gemini-2.5-flash', // Gemini is API-billed; default to the cheap Flash
      forceSubscription: true, // strip API-key env vars; use subscription login
      authorName: '', // if set, books are authored under this name (no invented pen name)
      research: true, // ground content with web search by default
      size: 'medium', // small | medium | large
      imageMode: 'off', // 'off' | 'ai' (CLI-designed SVG art) | 'stock' (Openverse)
      illustrate: false, // legacy flag (mapped to imageMode='stock')
      polish: true, // agentic editor pass for bestseller-grade prose
      // Nano Banana image generation (opt-in, image-only Gemini API key —
      // separate from the CLI subscription; never used for text generation).
      images: {
        provider: 'nano',
        geminiApiKey: '',
        model: 'gemini-3-pro-image', // Nano Banana Pro
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
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8');
      return deepMerge(this.defaultSettings(), JSON.parse(raw));
    } catch (_) {
      return this.defaultSettings();
    }
  }

  saveSettings(partial) {
    const merged = deepMerge(this.getSettings(), partial || {});
    fs.writeFileSync(this.settingsPath, JSON.stringify(merged, null, 2));
    return merged;
  }

  // ---- books ----

  bookPath(id) {
    return path.join(this.booksDir, `${id}.json`);
  }

  saveBook(book) {
    book.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.bookPath(book.id), JSON.stringify(book, null, 2));
    return book;
  }

  getBook(id) {
    return JSON.parse(fs.readFileSync(this.bookPath(id), 'utf8'));
  }

  deleteBook(id) {
    try {
      fs.unlinkSync(this.bookPath(id));
    } catch (_) {
      /* already gone */
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
          const stub = chs.find((c) => (c.words || 0) < 15 && (c.content || '').length < 200);
          if (stub) reason = { kind: 'short-chapter', detail: `Chapter ${stub.number} came back almost empty — click Continue to rewrite it.` };
          else if (planned && chs.length < planned) reason = { kind: 'incomplete', detail: `Only ${chs.length} of ${planned} chapters were written. Click Continue to finish.` };
        }
        if (reason) {
          // Drop trailing stub chapters so resume rewrites them from that point.
          if (Array.isArray(b.chapters)) {
            while (b.chapters.length && ((b.chapters[b.chapters.length - 1].words || 0) < 15) && ((b.chapters[b.chapters.length - 1].content || '').length < 200)) {
              b.chapters.pop();
            }
          }
          b.status = 'paused';
          b.pausedReason = { ...reason, message: reason.detail, resumable: true, at: new Date().toISOString() };
          b.words = (b.chapters || []).reduce((n, c) => n + ((c && c.words) || 0), 0);
          b.updatedAt = new Date().toISOString();
          fs.writeFileSync(p, JSON.stringify(b, null, 2));
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
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    }
    try { fs.rmSync(this.settingsPath, { force: true }); } catch (_) { /* ignore */ }
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
