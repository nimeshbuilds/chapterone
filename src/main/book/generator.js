'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  editPrompt,
  recapPrompt,
  coverSvgPrompt,
  chapterArtSvgPrompt,
  chapterArtHtmlPrompt,
  coverArtHtmlPrompt,
  coverImagePrompt,
  sceneImagePrompt,
  stockQueryPrompt,
  mastersPrompt,
  targetWordsForLength,
  kindOf,
} = require('./prompts');
const { bandOf, isKidsSpec, imagesForUnitIndex } = require('./ageBands');
const { generateImage } = require('./nanoBanana');
const { resolveChapterImages } = require('./images');
const { tidyProse, tidyText } = require('./typography');
const { extractJson } = require('./json');
const { sanitizeSvg, sanitizeHtml } = require('./aiArt');
const { classifyError, isResumable, describe } = require('./errors');

/** Resolve the image strategy from a spec (back-compat with the old flag). */
function imageModeOf(spec) {
  if (spec && spec.imageMode) return spec.imageMode; // 'ai' | 'stock' | 'off'
  return spec && spec.illustrate ? 'stock' : 'off';
}

/**
 * Insert an `image-search:` marker on its own line just after the chapter's
 * first prose paragraph (so the photo sits near the top, under the heading).
 * The resolver (book/images.js) turns it into a real Openverse image later.
 */
function insertImageMarker(content, caption, query) {
  const lines = String(content == null ? '' : content).split('\n');
  let idx = 0;
  while (idx < lines.length && (/^\s*#/.test(lines[idx]) || lines[idx].trim() === '')) idx++; // skip heading/blanks
  while (idx < lines.length && lines[idx].trim() !== '') idx++;                               // to end of 1st paragraph
  const marker = `![${String(caption || '').replace(/[[\]()]/g, '').trim()}](image-search: ${query})`;
  lines.splice(idx, 0, '', marker);
  return lines.join('\n');
}

/**
 * Orchestrates the multi-step book generation pipeline against a CLI engine.
 * Supports web-grounded research, and pause/resume when a subscription lapses.
 */
class BookGenerator {
  /**
   * @param {object} engine  ChainEngine / adapter with .complete()
   * @param {object} [opts]  { imageConfig: { apiKey, model, imagesDir } } for Nano Banana
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.imageConfig = opts.imageConfig || null;
  }

  /** The id of the engine that's actually active right now (handles fallback). */
  _engineId() {
    const e = this.engine;
    return (e && e.active && e.active.id) || (e && e.id) || null;
  }

  /** True when Nano Banana image generation is selected AND a key is configured. */
  _nanoReady(mode) {
    return mode === 'nano' && !!(this.imageConfig && this.imageConfig.apiKey && this.imageConfig.imagesDir);
  }

  /**
   * Stock-photo mode: guarantee the chapter has at least one image. If the
   * writing model already embedded an `image-search:` marker, leave it for the
   * resolver. Otherwise derive ONE concrete query and insert a marker, so a stock
   * photo appears regardless of how diligently the model followed the inline
   * instruction (Gemini, for one, tends to skip it). Best-effort and non-fatal.
   */
  async _ensureStockImage(book, chapter, planned, i, emit, signal) {
    // 1) Make sure the chapter has at least one image-search marker. If the writer
    //    embedded one, keep it; otherwise derive a concrete query and inject one.
    if (!/!\[[^\]]*\]\(\s*image-search:/i.test(chapter.content)) {
      emit('art:start', {
        index: i, number: planned.number, title: planned.title, method: 'stock',
        message: `Choosing a photo subject for Chapter ${planned.number}…`,
      });
      try {
        const raw = await this.engine.complete(stockQueryPrompt(book, planned, chapter.content), {
          system: 'You suggest stock-photo search queries. Reply with ONLY the query (3 to 7 concrete, photographable words) or the single word NONE. No quotes, no markdown, no explanation.',
          timeoutMs: 120000, signal, quiet: true,
        });
        const query = String(raw || '').trim().split('\n')[0].replace(/^[\s"'`*#>_-]+|[\s"'`*]+$/g, '').slice(0, 80);
        if (query && !/^none$/i.test(query)) {
          chapter.content = insertImageMarker(chapter.content, planned.title, query);
        }
      } catch (_) { /* a chapter without a photo is fine */ }
    }
    // 2) Resolve the photo NOW (inline), so a real image appears and the live
    //    counter advances per chapter instead of all at once at the very end.
    const imagesDir = this.imageConfig && this.imageConfig.imagesDir;
    if (!imagesDir) return;
    try {
      const added = await resolveChapterImages(book, chapter, {
        imagesDir, signal, onProgress: (e) => emit(e.phase, e),
      });
      if (added > 0) {
        this._imagesUsed = (this._imagesUsed || 0) + added;
        emit('image:added', { n: this._imagesUsed, total: book.outline.length, number: planned.number });
      }
    } catch (_) { /* non-fatal: keep writing even if image sourcing fails */ }
  }

  /** Persist a generated image buffer under <imagesDir>/<bookId>/<name>.<ext>. */
  _saveImage(book, name, img) {
    const dir = path.join(this.imageConfig.imagesDir, book.id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.${img.ext}`);
    fs.writeFileSync(file, img.buffer);
    return file;
  }

  /** Track how many paid images we've generated (for the UI / cost). */
  _tallyImage(book) {
    const model = (this.imageConfig && this.imageConfig.model) || '';
    book.imageStats = book.imageStats || { count: 0, model };
    book.imageStats.count += 1;
  }

  /** Triage step: figure out whether we need clarification. */
  async clarify(spec, opts = {}) {
    const text = await this.engine.complete(clarifyPrompt(spec), {
      system: 'You output only valid JSON. No markdown, no commentary.',
      timeoutMs: opts.timeoutMs || 120000,
      signal: opts.signal,
    });
    try {
      const json = extractJson(text);
      return {
        needsClarification: !!json.needsClarification,
        questions: Array.isArray(json.questions) ? json.questions : [],
        assumptions: Array.isArray(json.assumptions) ? json.assumptions : [],
        summary: json.summary || '',
      };
    } catch (_) {
      return { needsClarification: false, questions: [], assumptions: [], summary: '' };
    }
  }

  /**
   * Full generation. Emits progress through hooks.onProgress(event) and calls
   * hooks.onChapter(book) after each chapter so callers can persist progress.
   */
  async generate(spec, answers = {}, hooks = {}) {
    const { onProgress = () => {}, onChapter, signal } = hooks;
    const emit = (phase, payload = {}) => onProgress({ phase, ...payload });

    // Learn from the category's very best authors before planning, so the
    // outline and prose are engineered to surpass them.
    const influences = await this.studyInfluences(spec, emit, signal);

    emit('outline:start', { message: 'Designing the book and chapter outline…' });
    const outline = await this.buildOutline(spec, answers, signal, influences);

    const book = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'generating',
      provider: this.engine.id,
      model: this.engine.model || '',
      spec,
      answers,
      title: tidyText(outline.title || 'Untitled'),
      subtitle: tidyText(outline.subtitle || ''),
      author: (spec.authorName && spec.authorName.trim()) || outline.author || 'Anonymous',
      kind: kindOf({ kind: spec.kind }) || kindOf({ kind: outline.kind }) || '',
      isKids: !!isKidsSpec(spec),
      ageBand: spec.ageBand || '',
      characters: (spec.characters || []).filter((c) => c && c.name && c.name.trim()),
      genre: outline.genre || spec.genre || '',
      audience: outline.audience || spec.audience || '',
      logline: tidyText(outline.logline || ''),
      premise: tidyText(outline.premise || ''),
      themes: outline.themes || [],
      styleGuide: outline.styleGuide || '',
      influences: influences || null,
      outline: (outline.chapters || []).map((c, i) => ({
        number: c.number || i + 1,
        title: tidyText(c.title || `Chapter ${i + 1}`),
        summary: c.summary || '',
        beats: c.beats || [],
      })),
      chapters: [],
      images: [],
    };

    emit('outline:done', { title: book.title, chapters: book.outline.length, book });
    if (onChapter) await onChapter(book);

    await this._maybeCover(book, hooks);

    return this._writeChapters(book, 0, '', hooks);
  }

  /** Generate a cover: a real Nano Banana image, or an AI-designed SVG. */
  async _maybeCover(book, hooks = {}) {
    const { onProgress = () => {}, onChapter, signal } = hooks;
    const mode = imageModeOf(book.spec);
    if (book.coverSvg || book.coverPng) return;
    // A cover is ALWAYS generated. Nano Banana makes a real image when selected;
    // otherwise we design a vector cover and rasterize it to PNG (the default).

    if (this._nanoReady(mode)) {
      onProgress({ phase: 'cover:start', message: 'Painting the cover with Nano Banana…' });
      try {
        const img = await generateImage({
          apiKey: this.imageConfig.apiKey, model: this.imageConfig.model,
          prompt: coverImagePrompt(book), aspectRatio: '1:1', size: '2K', signal,
        });
        book.coverPng = this._saveImage(book, 'cover', img);
        book.updatedAt = new Date().toISOString();
        this._tallyImage(book);
        onProgress({ phase: 'cover:done', book });
        if (onChapter) await onChapter(book);
      } catch (err) {
        if (signal && signal.aborted) throw err;
        onProgress({ phase: 'image:error', message: `Cover image failed: ${err.message}` });
      }
      return;
    }

    onProgress({ phase: 'cover:start', message: 'Designing the book cover…' });
    try {
      // Preferred: a hybrid HTML/CSS + inline-SVG cover; fall back to pure SVG.
      const rawHtml = await this.engine.complete(coverArtHtmlPrompt(book), {
        system: 'You are a master book-cover designer. Output ONLY a single self-contained HTML fragment with an inline <style>. No commentary, no code fences.',
        timeoutMs: 300000, signal, quiet: true,
      });
      const html = sanitizeHtml(rawHtml);
      if (html) {
        book.coverHtml = html;
        book.updatedAt = new Date().toISOString();
        onProgress({ phase: 'cover:done', book });
        if (onChapter) await onChapter(book);
        return;
      }
      const raw = await this.engine.complete(coverSvgPrompt(book), {
        system: 'You are a master book-cover designer. Output only a single valid SVG.',
        timeoutMs: 300000, signal, quiet: true,
      });
      const svg = sanitizeSvg(raw);
      if (svg) {
        book.coverSvg = svg;
        book.updatedAt = new Date().toISOString();
        onProgress({ phase: 'cover:done', book });
        if (onChapter) await onChapter(book);
      }
    } catch (err) {
      if (signal && signal.aborted) throw err;
      // Non-fatal: a missing cover never blocks the book.
    }
  }

  /**
   * Generate one or more Nano Banana illustrations for a chapter. Count and
   * placement follow the kids age band (every-page → frequent → occasional);
   * for non-kids books, one image per chapter. Non-fatal on error.
   */
  async _nanoChapterArt(book, chapter, planned, i, hooks = {}) {
    const { onProgress = () => {}, signal } = hooks;
    const band = bandOf(book);
    const n = band ? imagesForUnitIndex(band, i) : 1; // adult Nano = 1 per chapter
    if (n <= 0) return;
    const aspect = band ? '4:3' : '16:9';
    for (let k = 0; k < n; k++) {
      onProgress({ phase: 'art:start', index: i, number: planned.number, title: planned.title, method: 'nano', message: `Illustrating Chapter ${planned.number} with Nano Banana…` });
      try {
        const hint = (planned.beats && planned.beats[k]) || planned.summary || planned.title;
        const img = await generateImage({
          apiKey: this.imageConfig.apiKey, model: this.imageConfig.model,
          prompt: sceneImagePrompt(book, planned, hint), aspectRatio: aspect, size: '1K', signal,
        });
        const file = this._saveImage(book, `ch${planned.number}-img${k + 1}`, img);
        if (k === 0) {
          chapter.artFile = file; // chapter-opener slot (shown above the prose)
        } else {
          const id = `nano-${planned.number}-${k}`;
          book.images.push({ id, ext: img.ext, mime: img.mime, file, caption: '' });
          chapter.content += `\n\n![](bwimg:${id})\n`;
        }
        this._tallyImage(book);
        onProgress({ phase: 'art:done', index: i, number: planned.number });
      } catch (err) {
        if (signal && signal.aborted) { this._markPaused(book, err.message); throw err; }
        onProgress({ phase: 'image:error', message: `Illustration failed: ${err.message}` });
        break; // stop trying further images for this chapter
      }
    }
  }

  /**
   * Continue an interrupted/paused book from where it stopped.
   */
  async resume(book, hooks = {}) {
    const startIndex = (book.chapters || []).length;
    book.status = 'generating';
    book.pausedReason = null;
    let prevRecap = '';
    if (startIndex > 0) {
      const last = book.chapters[startIndex - 1];
      try {
        prevRecap = await this.engine.complete(recapPrompt(last.title, last.content), {
          timeoutMs: 120000,
          signal: hooks.signal, quiet: true,
        });
      } catch (_) {
        prevRecap = (book.outline[startIndex - 1] || {}).summary || '';
      }
    }
    if (hooks.onProgress) {
      hooks.onProgress({ phase: 'resume', startIndex, total: book.outline.length, book });
    }
    await this._maybeCover(book, hooks);
    return this._writeChapters(book, startIndex, prevRecap, hooks);
  }

  /** Shared chapter-writing loop used by both generate() and resume(). */
  async _writeChapters(book, startIndex, prevRecap, hooks = {}) {
    const { onProgress = () => {}, onChapter, signal } = hooks;
    const emit = (phase, payload = {}) => onProgress({ phase, ...payload });
    const spec = book.spec || {};
    const band = bandOf(book);
    const targetWords = band ? band.wordsPerUnit : targetWordsForLength(spec);
    const minWords = band ? Math.max(8, Math.round(band.wordsPerUnit * 0.5)) : 200;
    const imageMode = imageModeOf(spec);
    const flags = { research: !!spec.research, illustrate: imageMode === 'stock', polish: spec.polish !== false };
    this._imagesUsed = (book.images || []).length; // resume continues the live count

    for (let i = startIndex; i < book.outline.length; i++) {
      if (signal && signal.aborted) {
        this._markPaused(book, 'Generation cancelled');
        if (onChapter) await onChapter(book);
        throw new Error('Generation cancelled');
      }
      const planned = book.outline[i];
      emit('chapter:start', {
        index: i, total: book.outline.length, number: planned.number, title: planned.title,
        message: `${flags.research ? 'Researching & writing' : 'Writing'} Chapter ${planned.number}: ${planned.title}`,
      });

      let prose;
      try {
        // Stream the draft to the UI in near real time (throttled).
        let acc = '';
        let lastEmit = 0;
        const onStdout = (chunk) => {
          acc += chunk;
          const now = Date.now();
          if (now - lastEmit > 180) {
            lastEmit = now;
            emit('chapter:stream', { index: i, number: planned.number, title: planned.title, preview: acc.slice(-1600) });
          }
        };
        prose = await this.engine.complete(
          chapterPrompt(book, planned, prevRecap, targetWords, flags),
          {
            system: 'You are writing publishable prose for a bestselling book. Obey the style guide. Output only the chapter in Markdown.',
            research: flags.research,
            onStdout,
            timeoutMs: 900000,
            minWords, // a too-short draft (e.g. a usage-limit stub) triggers chain fallback
            signal,
          }
        );
      } catch (err) {
        this._markPaused(book, err.message);
        if (onChapter) await onChapter(book);
        throw err;
      }

      let finalProse = prose;
      // Agentic editor pass: a second model call revises the draft to
      // bestseller quality before we keep it.
      if (flags.polish) {
        emit('chapter:polish', {
          index: i, number: planned.number, title: planned.title,
          message: `Editing & polishing Chapter ${planned.number}: ${planned.title}`,
        });
        try {
          const revised = await this.engine.complete(
            editPrompt(book, planned, cleanChapter(prose, planned.title), flags),
            {
              system: 'You are a world-class book editor. Output only the revised chapter in Markdown.',
              research: flags.research,
              timeoutMs: 900000,
              signal, quiet: true,
            }
          );
          if (revised && revised.trim().length > prose.trim().length * 0.5) {
            finalProse = revised; // accept only a substantive revision
          }
        } catch (err) {
          if (signal && signal.aborted) { this._markPaused(book, err.message); if (onChapter) await onChapter(book); throw err; }
          // Non-fatal: keep the solid draft if the polish pass fails.
        }
      }

      // Guard against a near-empty chapter (e.g. the CLI hit a usage/rate limit
      // and returned just a heading). Never accept it or mark the book complete:
      // pause so the user can resume and the chapter is retried.
      const draftWords = wordCount(finalProse);
      if (draftWords < minWords) {
        book.status = 'paused';
        book.pausedReason = {
          kind: 'short-chapter', resumable: true,
          message: `Chapter ${planned.number} came back too short (${draftWords} words)`,
          detail: `Chapter ${planned.number} came back almost empty (${draftWords} words) — usually a temporary quota or rate limit on your plan. Click Continue to finish the book.`,
          at: new Date().toISOString(),
        };
        book.updatedAt = new Date().toISOString();
        emit('chapter:short', { index: i, number: planned.number, words: draftWords });
        if (onChapter) await onChapter(book);
        throw new Error(`Chapter ${planned.number} came back too short (${draftWords} words). Resume to retry.`);
      }

      const chapter = {
        number: planned.number,
        title: tidyText(planned.title),
        content: tidyProse(cleanChapter(finalProse, planned.title)),
        words: draftWords,
      };
      book.chapters[i] = chapter;
      book.updatedAt = new Date().toISOString();

      // Illustrations: real Nano Banana images, an AI-designed SVG vignette, or a
      // royalty-free stock photo. The progress message names the method so the
      // user always knows which graphics engine is being used.
      if (this._nanoReady(imageMode)) {
        await this._nanoChapterArt(book, chapter, planned, i, hooks);
      } else if (imageMode === 'ai') {
        emit('art:start', { index: i, number: planned.number, title: planned.title, method: 'ai', message: `Illustrating Chapter ${planned.number}…` });
        try {
          // Preferred: a hybrid HTML/CSS + inline-SVG SCENE illustration (richer,
          // more relevant). Fall back to pure SVG if it doesn't come back clean.
          const rawHtml = await this.engine.complete(chapterArtHtmlPrompt(book, planned), {
            system: 'You are a world-class illustrator and front-end designer. Output ONLY a single self-contained HTML fragment (with an inline <style>) that draws the scene. No commentary, no code fences.',
            timeoutMs: 300000, signal, quiet: true,
          });
          const html = sanitizeHtml(rawHtml);
          if (html) {
            chapter.artHtml = html;
            emit('art:done', { index: i, number: planned.number });
          } else {
            const rawArt = await this.engine.complete(chapterArtSvgPrompt(book, planned), {
              system: 'You are an editorial illustrator. Output only a single valid SVG.',
              timeoutMs: 300000, signal, quiet: true,
            });
            const art = sanitizeSvg(rawArt);
            if (art) { chapter.artSvg = art; emit('art:done', { index: i, number: planned.number }); }
          }
        } catch (err) {
          if (signal && signal.aborted) { this._markPaused(book, err.message); if (onChapter) await onChapter(book); throw err; }
          // Non-fatal: a chapter without art is fine.
        }
      } else if (imageMode === 'stock') {
        await this._ensureStockImage(book, chapter, planned, i, emit, signal);
      }

      emit('chapter:done', {
        index: i, total: book.outline.length, number: planned.number,
        title: planned.title, words: chapter.words, book, engine: this._engineId(),
      });
      if (onChapter) await onChapter(book);

      if (i < book.outline.length - 1) {
        try {
          prevRecap = await this.engine.complete(recapPrompt(planned.title, chapter.content), {
            timeoutMs: 120000, signal, quiet: true,
          });
        } catch (_) {
          prevRecap = planned.summary;
        }
      }
    }

    book.status = 'complete';
    book.pausedReason = null;
    book.updatedAt = new Date().toISOString();
    book.words = book.chapters.reduce((n, c) => n + ((c && c.words) || 0), 0);
    emit('complete', { book });
    if (onChapter) await onChapter(book);
    return book;
  }

  _markPaused(book, message) {
    const kind = classifyError(message);
    book.status = 'paused';
    book.pausedReason = { kind, message, resumable: isResumable(kind), detail: describe(kind), at: new Date().toISOString() };
    book.updatedAt = new Date().toISOString();
  }

  async buildOutline(spec, answers, signal, influences) {
    const text = await this.engine.complete(outlinePrompt(spec, answers, influences), {
      system: 'You output only valid JSON describing a complete book outline. No commentary.',
      research: !!spec.research,
      timeoutMs: 300000,
      signal,
    });
    const json = extractJson(text);
    if (!json.chapters || !json.chapters.length) {
      throw new Error('The model did not return any chapters in the outline.');
    }
    return json;
  }

  /**
   * Identify and learn from the top authors in the book's category. Non-fatal:
   * if it fails, we proceed without an explicit benchmark.
   * @returns {Promise<{category,authors,blueprint}|null>}
   */
  async studyInfluences(spec, emit = () => {}, signal) {
    emit('influences:start', { message: 'Studying the category’s very best authors…' });
    try {
      const text = await this.engine.complete(mastersPrompt(spec), {
        system: 'You output only valid JSON. No markdown, no commentary.',
        research: !!spec.research,
        timeoutMs: 240000,
        signal, quiet: true,
      });
      const json = extractJson(text);
      const authors = Array.isArray(json.authors) ? json.authors.filter((a) => a && a.name) : [];
      if (!authors.length || !json.blueprint) {
        emit('influences:done', { authors: [], skipped: true });
        return null;
      }
      const influences = { category: json.category || spec.genre || '', authors, blueprint: json.blueprint };
      emit('influences:done', { authors: authors.map((a) => a.name), blueprint: influences.blueprint });
      return influences;
    } catch (err) {
      if (signal && signal.aborted) throw err;
      emit('influences:done', { authors: [], skipped: true });
      return null; // never block book creation on this enrichment step
    }
  }
}

// ---- helpers ----

function cleanChapter(text, title) {
  let t = (text || '').trim();
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) t = fence[1].trim();
  if (!/^#\s/m.test(t.split('\n')[0] || '')) {
    t = `# ${title}\n\n${t}`;
  }
  return t;
}

function wordCount(text) {
  const m = (text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

module.exports = { BookGenerator };
