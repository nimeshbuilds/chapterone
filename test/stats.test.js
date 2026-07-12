'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const s = require('../src/main/book/stats');

const SIMPLE = 'The cat sat on the mat. '.repeat(30).trim();
const ACADEMIC = ('Constitutional interpretation necessitates a comprehensive understanding of ' +
  'jurisprudential methodology, philosophical hermeneutics, and considerable institutional deliberation. ')
  .repeat(10).trim();

function bookWith(content) {
  return { title: 'T', chapters: [{ title: 'One', content }], createdAt: 0, updatedAt: 0, spec: {} };
}

test('simple repeated text grades as an early reader', () => {
  const st = s.bookStats(bookWith(SIMPLE));
  assert.ok(st.fkGrade !== null && st.fkGrade < 3, 'expected a low grade, got ' + st.fkGrade);
  assert.strictEqual(st.fkLabel, 'Early reader');
  assert.strictEqual(st.words, 180); // 6 words x 30 sentences
});

test('academic long-word text grades higher than the simple text', () => {
  const simple = s.bookStats(bookWith(SIMPLE));
  const academic = s.bookStats(bookWith(ACADEMIC));
  assert.ok(academic.fkGrade > simple.fkGrade,
    'expected ' + academic.fkGrade + ' > ' + simple.fkGrade);
  assert.ok(academic.fkGrade > 12);
  assert.strictEqual(academic.fkLabel, 'Adult');
});

test('mid-range prose gets a "≈ Grade N" label with one-decimal grade', () => {
  const st = s.bookStats(bookWith(
    'The morning sun climbed over the quiet harbor while fishermen prepared their wooden boats for another day.'
  ));
  assert.ok(st.fkGrade >= 2 && st.fkGrade <= 12, 'grade in label range, got ' + st.fkGrade);
  assert.match(st.fkLabel, /^≈ Grade \d+$/);
  assert.strictEqual(st.fkGrade, Math.round(st.fkGrade * 10) / 10); // one decimal
});

test('totals, minutes, pages, and per-chapter math from stored word counts', () => {
  const st = s.bookStats({
    title: 'T',
    chapters: [
      { title: 'One', content: SIMPLE, words: 300 },
      { title: 'Two', content: SIMPLE, words: 250 },
    ],
    spec: {},
  });
  assert.strictEqual(st.words, 550);
  assert.strictEqual(st.chapters, 2);
  assert.strictEqual(st.avgWordsPerChapter, 275);
  assert.strictEqual(st.readingMinutes, 2);   // round(550 / 230)
  assert.strictEqual(st.listeningMinutes, 4); // round(550 / 150)
  assert.strictEqual(st.pages, 2);            // ceil(550 / 275)
});

test('tiny books never show zero minutes or zero pages', () => {
  const st = s.bookStats({ chapters: [{ title: 'One', content: 'Hi there.', words: 40 }] });
  assert.strictEqual(st.words, 40);
  assert.strictEqual(st.readingMinutes, 1);
  assert.strictEqual(st.listeningMinutes, 1);
  assert.strictEqual(st.pages, 1);
});

test('word count is recomputed from markdown-stripped content when words is missing', () => {
  const st = s.bookStats(bookWith(
    '# The Start\n\nHello **brave** new [world](https://example.com).\n\n```js\nignored();\n```\n\n---\n\n![](bwimg:x)\n'
  ));
  assert.strictEqual(st.words, 6); // The Start Hello brave new world
});

test('empty or missing chapters yield zeros and a null grade', () => {
  for (const book of [{ title: 'T', chapters: [] }, {}, null]) {
    const st = s.bookStats(book);
    assert.deepStrictEqual(st, {
      words: 0,
      chapters: 0,
      readingMinutes: 0,
      listeningMinutes: 0,
      fkGrade: null,
      fkLabel: null,
      avgWordsPerChapter: 0,
      pages: 0,
    });
  }
});

test('syllable estimator handles vowel groups, silent endings, and minimums', () => {
  assert.strictEqual(s.estimateSyllables('cat'), 1);
  assert.strictEqual(s.estimateSyllables('mate'), 1);    // silent -e
  assert.strictEqual(s.estimateSyllables('table'), 2);   // audible -le
  assert.strictEqual(s.estimateSyllables('walked'), 1);  // silent -ed
  assert.strictEqual(s.estimateSyllables('wanted'), 2);  // audible -ted
  assert.strictEqual(s.estimateSyllables('makes'), 1);   // silent -es
  assert.strictEqual(s.estimateSyllables('boxes'), 2);   // audible -xes
  assert.strictEqual(s.estimateSyllables('methodology'), 5);
  assert.strictEqual(s.estimateSyllables('strengths'), 1); // min 1
  assert.strictEqual(s.estimateSyllables('2024'), 1);      // numbers are spoken
});
