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
    this.settingsPath = path.join(baseDir, 'settings.json');
    fs.mkdirSync(this.booksDir, { recursive: true });
    fs.mkdirSync(this.exportsDir, { recursive: true });
    fs.mkdirSync(this.imagesDir, { recursive: true });
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
      geminiModel: '',
      forceSubscription: true, // strip API-key env vars; use subscription login
      research: true, // ground content with web search by default
      size: 'medium', // small | medium | large
      imageMode: 'off', // 'off' | 'ai' (CLI-designed SVG art) | 'stock' (Openverse)
      illustrate: false, // legacy flag (mapped to imageMode='stock')
      polish: true, // agentic editor pass for bestseller-grade prose
      pdfEmailTo: '', // remembered recipient for "Email as PDF"
      kindle: {
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
