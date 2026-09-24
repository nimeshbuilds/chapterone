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
      // A realistic-length chapter (above the generator's too-short floor).
      const body = `This is chapter ${m[1]} prose with several words here. `.repeat(40);
      return `# ${m[2]}\n\n${body.trim()}`;
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

test('a too-short chapter pauses the book instead of falsely completing', async () => {
  const engine = new FakeEngine();
  engine.complete = async (prompt) => {
    if (/market-ready book/.test(prompt)) {
      return JSON.stringify({ title: 'T', author: 'A', premise: 'p', styleGuide: 's', chapters: [{ number: 1, title: 'One', summary: 's', beats: [] }] });
    }
    if (/WRITE CHAPTER/.test(prompt)) return '# One\n\nToo short.'; // ~2 words of body
    return '{}';
  };
  const gen = new BookGenerator(engine);
  let last = null;
  await assert.rejects(
    gen.generate({ request: 'x', polish: false, research: false }, {}, { onChapter: (b) => { last = b; } }),
    /too short/i
  );
  assert.ok(last);
  assert.strictEqual(last.status, 'paused');
  assert.strictEqual(last.pausedReason.kind, 'short-chapter');
  assert.strictEqual(last.chapters.filter(Boolean).length, 0); // the stub was NOT kept
});

test('cancelling at outline review persists a resumable draft immediately', async () => {
  const gen = new BookGenerator(new FakeEngine());
  let saved;
  await assert.rejects(gen.generate({ request: 'x', reviewOutline: true }, {}, {
    onChapter: (b) => { saved = structuredClone(b); },
    onOutlineReview: () => { throw new Error('Generation cancelled'); },
  }), /cancelled/);
  assert.equal(saved.status, 'paused');
  assert.equal(saved.chapters.length, 0);
  assert.ok(saved.outline.length);
});

test('completed prose is saved before an optional illustration can fail', async () => {
  const gen = new BookGenerator(new FakeEngine());
  let saved;
  gen._nanoReady = () => true;
  gen._maybeCover = async () => {};
  gen._nanoChapterArt = async () => {
    assert.ok(saved.chapters[0].content.length > 200);
    throw new Error('Image connection lost');
  };
  await assert.rejects(gen.generate({ request: 'x', imageMode: 'nano', polish: false }, {}, {
    onChapter: (b) => { saved = structuredClone(b); },
  }), /connection lost/);
  assert.equal(saved.status, 'paused');
  assert.ok(saved.chapters[0].content.length > 200);
});

test('No images and the unset default make no cover, illustration or image API requests', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-no-images-'));
  t.after(() => fs.rmSync(imagesDir, { recursive: true, force: true }));
  const https = require('node:https');
  let networkCalls = 0;
  t.mock.method(https, 'request', () => { networkCalls++; throw new Error('Network calls are forbidden in this fixture'); });
  for (const imageSpec of [{ imageMode: 'off', illustrate: true }, {}, { illustrate: false }]) {
    const engine = new FakeEngine();
    const gen = new BookGenerator(engine, { imageConfig: {
      apiKey: 'offline-fixture', imagesDir,
    } });
    const phases = [];
    const book = await gen.generate({ request: 'A river voyage', research: false, polish: false, ...imageSpec }, {}, {
      onProgress: (event) => phases.push(event.phase),
    });
    assert.equal(book.status, 'complete');
    assert.equal(book.coverHtml, undefined);
    assert.equal(book.coverSvg, undefined);
    assert.equal(book.coverPng, undefined);
    assert.ok(book.chapters.every((chapter) => !chapter.artHtml && !chapter.artSvg && !chapter.artFile));
    assert.ok(!phases.some((phase) => /^(cover|art):/.test(phase)));
    assert.ok(engine.calls.every((call) => !/book-cover designer|illustrator/.test(call.opts.system || '')));
  }
  assert.equal(networkCalls, 0);
  assert.deepStrictEqual(fs.readdirSync(imagesDir), [], 'No images mode must not write artwork files');
});

test('opting into AI art still generates and saves a cover and chapter illustrations', async () => {
  const engine = new FakeEngine();
  const complete = engine.complete.bind(engine);
  engine.complete = async (prompt, opts = {}) => {
    if (/book-cover designer|illustrator/.test(opts.system || '')) {
      engine.calls.push({ prompt, opts });
      return '<div style="width:800px;height:1000px;background:#336699">A painted river</div>';
    }
    return complete(prompt, opts);
  };
  const gen = new BookGenerator(engine);
  const saved = [];
  const book = await gen.generate({ request: 'A river voyage', imageMode: 'ai', research: false, polish: false }, {}, {
    onChapter: (value) => saved.push(structuredClone(value)),
  });
  assert.ok(book.coverHtml);
  assert.ok(book.chapters.every((chapter) => chapter.artHtml));
  assert.ok(saved.some((value) => value.coverHtml && value.chapters.length === 0));
  assert.ok(engine.calls.some((call) => /book-cover designer/.test(call.opts.system || '')));
});

test('resuming with No images preserves existing art and never fills a missing cover', async () => {
  for (const cover of [undefined, '<svg width="100" height="100"><rect width="100" height="100"/></svg>']) {
    const engine = new FakeEngine();
    const gen = new BookGenerator(engine);
    const book = { id: 'resume-no-images', status: 'paused', title: 'River', spec: { imageMode: 'off', polish: false },
      outline: [{ number: 1, title: 'Open', summary: 'A voyage.' }], chapters: [], images: [], coverSvg: cover };
    const phases = [];
    await gen.resume(book, { onProgress: (event) => phases.push(event.phase) });
    assert.equal(book.status, 'complete');
    assert.equal(book.coverSvg, cover);
    assert.equal(book.coverHtml, undefined);
    assert.ok(!phases.some((phase) => /^(cover|art):/.test(phase)));
    assert.ok(engine.calls.every((call) => !/book-cover designer|illustrator/.test(call.opts.system || '')));
  }
});

test('legacy illustration opt-in still allows cover artwork', async () => {
  let requests = 0;
  const gen = new BookGenerator({ complete: async () => {
    requests++;
    return '<div style="width:800px;height:1000px;background:#336699">Legacy cover</div>';
  } });
  const book = { title: 'River', spec: { illustrate: true } };
  await gen._maybeCover(book);
  assert.equal(requests, 1);
  assert.ok(book.coverHtml);
});
