'use strict';

const { randomUUID } = require('crypto');
const {
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  recapPrompt,
  targetWordsForLength,
} = require('./prompts');
const { extractJson } = require('./json');

/**
 * Orchestrates the multi-step book generation pipeline against a CLI engine.
 */
class BookGenerator {
  /**
   * @param {object} engine  An adapter with .complete(prompt, opts)
   */
  constructor(engine) {
    this.engine = engine;
  }

  /**
   * Triage step: figure out whether we need clarification.
   * @returns {Promise<{needsClarification:boolean, questions:Array, assumptions:Array, summary:string}>}
   */
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
      // If parsing fails, default to proceeding without questions.
      return { needsClarification: false, questions: [], assumptions: [], summary: '' };
    }
  }

  /**
   * Full generation. Emits progress through `onProgress(event)`.
   * `onChapter(book)` is called after each chapter so callers can persist
   * partial progress (crash-safe, resumable, live preview).
   *
   * @param {object} spec
   * @param {object} answers          Reader answers to clarifying questions.
   * @param {object} hooks
   * @param {(e:object)=>void} [hooks.onProgress]
   * @param {(book:object)=>void|Promise<void>} [hooks.onChapter]
   * @param {AbortSignal} [hooks.signal]
   * @returns {Promise<object>} the completed book
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
    };

    emit('outline:done', {
      title: book.title,
      chapters: book.outline.length,
      book,
    });
    if (onChapter) await onChapter(book);

    const targetWords = targetWordsForLength(spec.length);
    let prevRecap = '';

    for (let i = 0; i < book.outline.length; i++) {
      if (signal && signal.aborted) throw new Error('Generation cancelled');
      const planned = book.outline[i];
      emit('chapter:start', {
        index: i,
        total: book.outline.length,
        number: planned.number,
        title: planned.title,
        message: `Writing Chapter ${planned.number}: ${planned.title}`,
      });

      const prose = await this.engine.complete(
        chapterPrompt(book, planned, prevRecap, targetWords),
        {
          system: `You are writing publishable prose for a bestselling book. Obey the style guide. Output only the chapter in Markdown.`,
          timeoutMs: 600000,
          signal,
        }
      );

      const chapter = {
        number: planned.number,
        title: planned.title,
        content: cleanChapter(prose, planned.title),
        words: wordCount(prose),
      };
      book.chapters.push(chapter);
      book.updatedAt = new Date().toISOString();

      emit('chapter:done', {
        index: i,
        total: book.outline.length,
        number: planned.number,
        title: planned.title,
        words: chapter.words,
        book,
      });
      if (onChapter) await onChapter(book);

      // Build a compact recap for continuity, except after the final chapter.
      if (i < book.outline.length - 1) {
        try {
          prevRecap = await this.engine.complete(
            recapPrompt(planned.title, chapter.content),
            { timeoutMs: 120000, signal }
          );
        } catch (_) {
          prevRecap = planned.summary; // fall back to the planned summary
        }
      }
    }

    book.status = 'complete';
    book.updatedAt = new Date().toISOString();
    book.words = book.chapters.reduce((n, c) => n + (c.words || 0), 0);
    emit('complete', { book });
    if (onChapter) await onChapter(book);
    return book;
  }

  async buildOutline(spec, answers, signal) {
    const text = await this.engine.complete(outlinePrompt(spec, answers), {
      system: 'You output only valid JSON describing a complete book outline. No commentary.',
      timeoutMs: 240000,
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
  // Remove wrapping code fences if the model added them.
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) t = fence[1].trim();
  // Ensure a heading exists.
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
