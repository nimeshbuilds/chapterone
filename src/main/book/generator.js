'use strict';

const { randomUUID } = require('crypto');
const {
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  editPrompt,
  recapPrompt,
  coverSvgPrompt,
  chapterArtSvgPrompt,
  targetWordsForLength,
} = require('./prompts');
const { extractJson } = require('./json');
const { sanitizeSvg } = require('./aiArt');
const { classifyError, isResumable, describe } = require('./errors');

/** Resolve the image strategy from a spec (back-compat with the old flag). */
function imageModeOf(spec) {
  if (spec && spec.imageMode) return spec.imageMode; // 'ai' | 'stock' | 'off'
  return spec && spec.illustrate ? 'stock' : 'off';
}

/**
 * Orchestrates the multi-step book generation pipeline against a CLI engine.
 * Supports web-grounded research, and pause/resume when a subscription lapses.
 */
class BookGenerator {
  constructor(engine) {
    this.engine = engine;
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

    emit('outline:start', { message: 'Designing the book and chapter outline…' });
    const outline = await this.buildOutline(spec, answers, signal);

    const book = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'generating',
      provider: this.engine.id,
      model: this.engine.model || '',
      spec,
      answers,
      title: outline.title || 'Untitled',
      subtitle: outline.subtitle || '',
      author: outline.author || 'Anonymous',
      genre: outline.genre || spec.genre || '',
      audience: outline.audience || spec.audience || '',
      logline: outline.logline || '',
      premise: outline.premise || '',
      themes: outline.themes || [],
      styleGuide: outline.styleGuide || '',
      outline: (outline.chapters || []).map((c, i) => ({
        number: c.number || i + 1,
        title: c.title || `Chapter ${i + 1}`,
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

  /** Generate an AI-designed SVG cover when image art is enabled. */
  async _maybeCover(book, hooks = {}) {
    const { onProgress = () => {}, onChapter, signal } = hooks;
    if (imageModeOf(book.spec) === 'off' || book.coverSvg) return;
    onProgress({ phase: 'cover:start', message: 'Designing the book cover…' });
    try {
      const raw = await this.engine.complete(coverSvgPrompt(book), {
        system: 'You are a master book-cover designer. Output only a single valid SVG.',
        timeoutMs: 300000,
        signal,
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
          signal: hooks.signal,
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
    const targetWords = targetWordsForLength(spec);
    const imageMode = imageModeOf(spec);
    const flags = { research: !!spec.research, illustrate: imageMode === 'stock', polish: spec.polish !== false };

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
              signal,
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

      const chapter = {
        number: planned.number,
        title: planned.title,
        content: cleanChapter(finalProse, planned.title),
        words: wordCount(finalProse),
      };
      book.chapters[i] = chapter;
      book.updatedAt = new Date().toISOString();

      // One AI-designed illustration per chapter (when AI art is enabled).
      if (imageMode === 'ai') {
        emit('art:start', { index: i, number: planned.number, title: planned.title, message: `Illustrating Chapter ${planned.number}…` });
        try {
          const rawArt = await this.engine.complete(chapterArtSvgPrompt(book, planned), {
            system: 'You are an editorial illustrator. Output only a single valid SVG.',
            timeoutMs: 300000, signal,
          });
          const art = sanitizeSvg(rawArt);
          if (art) { chapter.artSvg = art; emit('art:done', { index: i, number: planned.number }); }
        } catch (err) {
          if (signal && signal.aborted) { this._markPaused(book, err.message); if (onChapter) await onChapter(book); throw err; }
          // Non-fatal: a chapter without art is fine.
        }
      }

      emit('chapter:done', {
        index: i, total: book.outline.length, number: planned.number,
        title: planned.title, words: chapter.words, book,
      });
      if (onChapter) await onChapter(book);

      if (i < book.outline.length - 1) {
        try {
          prevRecap = await this.engine.complete(recapPrompt(planned.title, chapter.content), {
            timeoutMs: 120000, signal,
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

  async buildOutline(spec, answers, signal) {
    const text = await this.engine.complete(outlinePrompt(spec, answers), {
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
