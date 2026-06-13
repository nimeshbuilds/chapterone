'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { BookGenerator } = require('../src/main/book/generator');

/** A scripted fake engine that returns canned responses by prompt content. */
class FakeEngine {
  constructor() {
    this.id = 'fake';
    this.model = 'fake-1';
    this.calls = [];
  }
  async complete(prompt, opts = {}) {
    this.calls.push({ prompt, opts });
    // Simulate async work that honors cancellation, like the real adapters.
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 5);
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('Aborted'));
        }, { once: true });
      }
    });
    if (/needsClarification/.test(prompt)) {
      return '```json\n{"needsClarification":true,"questions":[{"id":"tone","question":"Tone?","suggestions":["dark"]}],"assumptions":[],"summary":"a thriller"}\n```';
    }
    if (/market-ready book/.test(prompt)) {
      return JSON.stringify({
        title: 'Test Title',
        subtitle: 'A Test',
        author: 'Pen Name',
        genre: 'Thriller',
        audience: 'Adults',
        logline: 'one line',
        premise: 'premise',
        themes: ['trust'],
        styleGuide: 'tense third person',
        chapters: [
          { number: 1, title: 'Open', summary: 's1', beats: ['b'] },
          { number: 2, title: 'Close', summary: 's2', beats: ['b'] },
        ],
      });
    }
    if (/WRITE CHAPTER/.test(prompt)) {
      const m = prompt.match(/WRITE CHAPTER (\d+): "([^"]+)"/);
      return `# ${m[2]}\n\nThis is chapter ${m[1]} prose with several words here.`;
    }
    if (/Summarize the following chapter/.test(prompt)) {
      return 'A short recap.';
    }
    return '{}';
  }
}

test('clarify returns questions when model asks', async () => {
  const gen = new BookGenerator(new FakeEngine());
  const res = await gen.clarify({ request: 'a thriller' });
  assert.strictEqual(res.needsClarification, true);
  assert.strictEqual(res.questions.length, 1);
});

test('generate produces a complete book with chapters', async () => {
  const engine = new FakeEngine();
  const gen = new BookGenerator(engine);
  const events = [];
  const saved = [];
  const book = await gen.generate(
    { request: 'a thriller', length: 'short' },
    { tone: 'dark' },
    { onProgress: (e) => events.push(e.phase), onChapter: (b) => saved.push(b.chapters.length) }
  );

  assert.strictEqual(book.status, 'complete');
  assert.strictEqual(book.title, 'Test Title');
  assert.strictEqual(book.chapters.length, 2);
  assert.ok(book.words > 0);
  assert.ok(book.chapters[0].content.startsWith('# Open'));
  // progress lifecycle
  assert.ok(events.includes('outline:done'));
  assert.ok(events.includes('chapter:done'));
  assert.ok(events.includes('complete'));
  // persisted progressively (outline + 2 chapters + final)
  assert.ok(saved.length >= 3);
});

test('resume continues a paused book from where it stopped', async () => {
  const engine = new FakeEngine();
  const gen = new BookGenerator(engine);
  // A book paused after writing only the first of two chapters.
  const book = {
    id: 'r1', status: 'paused',
    spec: { request: 'x', length: 'short' },
    title: 'Test Title', genre: 'Thriller', audience: 'Adults', premise: 'p', themes: [],
    styleGuide: 'tense',
    outline: [
      { number: 1, title: 'Open', summary: 's1', beats: ['b'] },
      { number: 2, title: 'Close', summary: 's2', beats: ['b'] },
    ],
    chapters: [{ number: 1, title: 'Open', content: '# Open\n\nAlready written.', words: 3 }],
    images: [],
  };
  const done = await gen.resume(book, {});
  assert.strictEqual(done.status, 'complete');
  assert.strictEqual(done.chapters.length, 2);
  assert.ok(done.chapters[1].content.startsWith('# Close'));
});

test('a failed chapter marks the book paused with a reason', async () => {
  const engine = new FakeEngine();
  // Force the chapter call to fail.
  engine.complete = async (prompt) => {
    if (/market-ready book/.test(prompt)) {
      return JSON.stringify({ title: 'T', author: 'A', premise: 'p', styleGuide: 's', chapters: [{ number: 1, title: 'One', summary: 's', beats: [] }] });
    }
    if (/WRITE CHAPTER/.test(prompt)) throw new Error('insufficient credit balance');
    return '{}';
  };
  const gen = new BookGenerator(engine);
  let lastBook = null;
  await assert.rejects(
    gen.generate({ request: 'x' }, {}, { onChapter: (b) => { lastBook = b; } }),
    /credit/
  );
  assert.ok(lastBook);
  assert.strictEqual(lastBook.status, 'paused');
  assert.strictEqual(lastBook.pausedReason.kind, 'subscription');
  assert.strictEqual(lastBook.pausedReason.resumable, true);
});

test('generate can be aborted', async () => {
  const engine = new FakeEngine();
  const gen = new BookGenerator(engine);
  const ac = new AbortController();
  // Abort during the first async engine call.
  setTimeout(() => ac.abort(), 1);
  await assert.rejects(
    gen.generate({ request: 'x' }, {}, { signal: ac.signal }),
    /cancelled|Aborted/i
  );
});
