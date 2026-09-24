'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bookReadiness } = require('../src/main/book/readiness');

const book = (chapters = [{ title: 'Opening', number: 1, content: '# Opening\n\nA river carries the boat home.' }]) =>
  ({ title: 'River', author: 'Test Author', status: 'complete', chapters });

test('a clean draft has no findings but never claims it is publication certified', () => {
  const source = book();
  const before = JSON.stringify(source);
  const report = bookReadiness(source);
  assert.equal(report.status, 'clear');
  assert.deepEqual(report.checks, []);
  assert.equal(report.summary.chapters, 1);
  assert.ok(report.summary.words > 0);
  assert.match(report.limitations, /does not verify facts, originality, permissions, continuity/);
  assert.equal(JSON.stringify(source), before, 'readiness must be read-only');
});

test('empty and missing planned chapters are separate actionable findings', () => {
  const source = book([{ title: 'Opening', number: 1, content: '# Opening\n\n![Picture](bwimg:one)' }, null]);
  source.outline = [{ title: 'Opening' }, { title: 'Ending' }];
  source.status = 'paused';
  const report = bookReadiness(source);
  assert.equal(report.status, 'needs-attention');
  assert.equal(report.summary.errors, 2);
  assert.equal(report.summary.plannedChapters, 2);
  assert.equal(report.checks.find((item) => item.id === 'empty-chapter-0').chapterIndex, 0);
  assert.match(report.checks.find((item) => item.id === 'missing-chapter-1').detail, /Ending/);
  assert.equal(report.checks.find((item) => item.id === 'missing-chapter-1').chapterAvailable, false);
  assert.equal(report.checks.find((item) => item.id === 'empty-chapter-0').chapterAvailable, true);
  assert.ok(report.checks.some((item) => item.id === 'unfinished-draft'));
});

test('draft markers, duplicate titles and repeated headings return specific evidence', () => {
  const source = book([
    { title: 'Arrival', content: '# Arrival\n\nTODO: expand the ending.\n\n## A decision\n\nSome text.\n\n## A decision\n\nMore text.' },
    { title: ' arrival ', content: '# Arrival\n\n[Insert final paragraph here]' },
  ]);
  const report = bookReadiness(source);
  assert.equal(report.status, 'review');
  assert.equal(report.summary.errors, 0);
  assert.match(report.checks.find((item) => item.id === 'draft-marker-0').excerpt, /TODO/);
  assert.equal(report.checks.find((item) => item.id === 'repeated-heading-0').excerpt, 'A decision');
  assert.equal(report.checks.find((item) => item.id === 'duplicate-title-1').chapterIndex, 1);
});

test('code examples and ordinary multilingual prose do not masquerade as draft markers', () => {
  const source = book([{ title: 'Notes', content: '# Notes\n\nTodo lo que tengo. नमस्ते दुनिया। 你好世界。\n\n```js\n// TODO: demonstrate a task list\n## Same\n## Same\n```\n\n~~~text\n[Insert example]\n~~~' }]);
  const report = bookReadiness(source);
  assert.deepEqual(report.checks, []);
  assert.ok(report.summary.words >= 7);
  assert.equal(bookReadiness(book([{ title: '技术', content: '# 技术\n\n```\nprint(123)\n```' }])).summary.errors, 0);
});

test('exact repeated long passages are review suggestions with bounded excerpts', () => {
  const passage = 'The boat was resting beneath the willow while the family watched the water. '.repeat(4).trim();
  const report = bookReadiness(book([
    { title: 'Morning', content: '# Morning\n\n' + passage },
    { title: 'Evening', content: '# Evening\n\n' + passage },
  ]));
  const finding = report.checks.find((item) => item.id === 'repeated-paragraph-1');
  assert.equal(finding.severity, 'warning');
  assert.match(finding.detail, /Chapter 1/);
  assert.ok(finding.excerpt.length <= 180);
});

test('unresolved image requests and missing metadata are reviewable without paid provider calls', () => {
  const report = bookReadiness({ chapters: [{ content: 'Written prose.\n\n![Water](image-search:river)' }] });
  assert.ok(report.checks.some((item) => item.id === 'missing-title'));
  assert.ok(report.checks.some((item) => item.id === 'missing-author'));
  assert.ok(report.checks.some((item) => item.id === 'missing-chapter-title-0'));
  assert.ok(report.checks.some((item) => item.id === 'unresolved-image-0'));
  assert.equal(report.summary.errors, 0);
  assert.equal(bookReadiness({}).summary.errors, 1);
});

test('revision snapshots are not analyzed as current manuscript content', () => {
  const source = book();
  source.chapters[0].revisions = [{ content: 'TODO: finish. [Insert ending]' }];
  assert.equal(bookReadiness(source).status, 'clear');
});

test('empty-body detection parses markup and ignores executable/style content', () => {
  const onlyMarkup = book([{ title: 'Opening', content: '# Opening\n\n<script>not manuscript prose</script >'
    + '<style>.visible{color:red}</style><img alt="Not chapter prose" src="file:///private">' }]);
  assert.equal(bookReadiness(onlyMarkup).summary.errors, 1);
  const encodedProse = book([{ title: 'Opening', content: '# Opening\n\n<p>&#65; real paragraph.</p>' }]);
  assert.equal(bookReadiness(encodedProse).summary.errors, 0);
  const literalHtmlCode = book([{ title: 'Example', content: '# Example\n\n```\n<div></div>\n```' }]);
  assert.equal(bookReadiness(literalHtmlCode).summary.errors, 0);
});
