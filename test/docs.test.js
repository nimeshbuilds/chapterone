'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSite, validateSite, headingId, renderMarkdown, rewriteLink } = require('../scripts/docs-build.cjs');
const root = path.resolve(__dirname, '..');
const site = path.join(root, 'docs/site');
const config = JSON.parse(fs.readFileSync(path.join(site, 'site.json'), 'utf8'));

test('handbook builds every guide with valid links, anchors, assets and searchable text', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = buildSite(dir);
  assert.equal(result.pages, config.pages.length);
  assert.equal(result.htmlFiles, config.pages.length + 1);
  const entries = JSON.parse(fs.readFileSync(path.join(dir, 'search-index.json'), 'utf8'));
  assert.equal(entries.length, config.pages.length);
  for (const page of config.pages) {
    const html = fs.readFileSync(path.join(dir, `${page.slug}.html`), 'utf8');
    assert.equal((html.match(/<h1>/g) || []).length, 1, page.slug);
    assert.ok(html.includes(`href="${page.slug}.html" aria-current="page"`), page.slug);
    assert.ok(html.includes('Skip to content'), page.slug);
    assert.ok(html.includes('Content-Security-Policy'), page.slug);
    assert.match(html, /<main id="main" tabindex="-1"/);
    assert.ok(entries.find((entry) => entry.url === `${page.slug}.html`).text.length > 200);
    assert.doesNotMatch(html, /<script[^>]+src="https?:/);
    assert.doesNotMatch(html, /<link[^>]+href="https?:[^>]+rel="stylesheet"/);
  }
  assert.match(fs.readFileSync(path.join(dir, 'model-reference.html'), 'utf8'), /Model catalog/);
  assert.ok(fs.readFileSync(path.join(dir, '404.html'), 'utf8').includes('href="https://nimeshbuilds.github.io/chapterone/assets/site.css"'));
});

test('Markdown references map to handbook pages or existing repository files', () => {
  const source = path.join(root, 'docs/ARCHITECTURE.md');
  assert.equal(rewriteLink('RELEASING.md#maintenance', source, config.pages, config.repository), 'releasing.html#maintenance');
  assert.equal(rewriteLink('../SIGNING.md', source, config.pages, config.repository), `${config.repository}/blob/main/SIGNING.md`);
  assert.throws(() => rewriteLink('../../../private.md', source, config.pages, config.repository), /Broken repository reference/);
  assert.throws(() => rewriteLink('missing.md', source, config.pages, config.repository), /Broken repository reference/);
  assert.throws(() => rewriteLink('javascript:alert(1)', source, config.pages, config.repository), /Unsupported/);
  assert.throws(() => rewriteLink('//evil.example', source, config.pages, config.repository), /Unsupported/);
});

test('rendered documentation strips active HTML and keeps stable unique section IDs', () => {
  const md = '## Café & revision\n\n<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(1)">\n\n## Café & revision\n\n[Read](quickstart.md)';
  const output = renderMarkdown(md, path.join(site, 'content/index.md'), config.pages, config.repository);
  assert.equal(headingId('Café & revision'), 'café-revision');
  assert.deepEqual(output.headings.map((item) => item.id), ['café-revision', 'café-revision-1']);
  assert.doesNotMatch(output.html, /<script|onerror=/);
  assert.match(output.html, /href="quickstart.html"/);
});

test('link validation rejects broken fragments and paths outside generated output', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-docs-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1 id="ready">Ready</h1><a href="#missing">Broken</a>');
  assert.throws(() => validateSite(dir), /missing anchor/);
  fs.writeFileSync(path.join(dir, 'index.html'), '<a href="../outside.txt">Outside</a>');
  assert.throws(() => validateSite(dir), /missing\/unsafe/);
  fs.writeFileSync(path.join(dir, 'index.html'), '<a href="javascript:alert(1)">Unsafe</a>');
  assert.throws(() => validateSite(dir), /unsafe URL/);
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1 id="ready">Ready</h1><a href="#ready">Ready</a>');
  assert.equal(validateSite(dir), 1);
});
