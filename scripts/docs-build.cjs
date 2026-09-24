#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'docs/site');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textOnly = (value) => sanitizeHtml(String(value), { allowedTags: [], allowedAttributes: {} })
  .replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (s) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[s]))
  .replace(/\s+/g, ' ').trim();

function headingId(text) {
  return textOnly(text).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
}

function resolvePageSource(page) {
  const file = path.resolve(SITE, 'content', page.source || `${page.slug}.md`);
  if (!file.startsWith(`${path.join(ROOT, 'docs')}${path.sep}`) || !file.endsWith('.md')) {
    throw new Error(`Invalid documentation source: ${page.source}`);
  }
  return file;
}

function rewriteLink(href, source, pages, repository) {
  if (!href || href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) return href;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) throw new Error(`Unsupported documentation URL: ${href}`);
  const [pathname, fragment] = href.split('#');
  if (!pathname.endsWith('.md')) return href;
  const destination = path.resolve(path.dirname(source), decodeURIComponent(pathname));
  const page = pages.find((entry) => resolvePageSource(entry) === destination
    || path.join(SITE, 'content', `${entry.slug}.md`) === destination);
  if (page) return `${page.slug}.html${fragment ? `#${fragment}` : ''}`;
  const relative = path.relative(ROOT, destination);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(destination)) {
    throw new Error(`Broken repository reference in ${source}: ${href}`);
  }
  return `${repository}/blob/main/${relative.split(path.sep).map(encodeURIComponent).join('/')}${fragment ? `#${fragment}` : ''}`;
}

function renderMarkdown(markdown, source, pages, repository) {
  const headings = [];
  const ids = new Map();
  const renderer = new marked.Renderer();
  renderer.heading = (text, level) => {
    const base = headingId(text);
    const count = ids.get(base) || 0;
    ids.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    if (level === 2 || level === 3) headings.push({ id, level, text: textOnly(text) });
    return `<h${level} id="${escape(id)}">${text}<a class="heading-anchor" href="#${escape(id)}" aria-label="Link to ${escape(textOnly(text))}">#</a></h${level}>\n`;
  };
  renderer.link = (href, title, text) => `<a href="${escape(rewriteLink(href, source, pages, repository))}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`;
  renderer.table = (header, body) => `<div class="table-wrap" role="region" tabindex="0" aria-label="Scrollable comparison table"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  const raw = marked.parse(markdown.replace(/^# [^\n]+\n+/, ''), { renderer, mangle: false, headerIds: false });
  const html = sanitizeHtml(raw, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['id', 'class', 'role', 'tabindex', 'aria-label'],
      a: ['href', 'title', 'aria-label', 'class'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      th: ['align'], td: ['align'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  });
  return { html, headings, text: textOnly(html.replace(/<a class="heading-anchor"[^>]*>.*?<\/a>/g, '')) };
}

function navHtml(pages, active) {
  let previous;
  return pages.map((page) => {
    const group = page.section !== previous ? `${previous ? '</ul></section>' : ''}<section class="nav-group"><h2>${escape(page.section)}</h2><ul>` : '';
    previous = page.section;
    return `${group}<li><a href="${page.slug}.html"${page.slug === active ? ' aria-current="page"' : ''}>${escape(page.nav)}</a></li>`;
  }).join('') + '</ul></section>';
}

function pageHtml(page, rendered, config, version) {
  const home = page.slug === 'index';
  const index = config.pages.findIndex((item) => item.slug === page.slug);
  const previous = config.pages[index - 1];
  const next = config.pages[index + 1];
  const source = path.relative(ROOT, resolvePageSource(page)).split(path.sep).join('/');
  const toc = rendered.headings.filter((heading) => heading.level === 2);
  const pageLink = (item, label) => item ? `<a href="${item.slug}.html"><span>${label}</span><strong>${escape(item.nav)} <span aria-hidden="true">${label === 'Next' ? '→' : '←'}</span></strong></a>` : '<span></span>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escape(page.description)}">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';">
  <title>${escape(page.title)} · ChapterOne Handbook</title>
  <link rel="canonical" href="${config.url}/${home ? '' : `${page.slug}.html`}">
  <meta property="og:title" content="${escape(page.title)} · ChapterOne">
  <meta property="og:description" content="${escape(page.description)}">
  <meta property="og:type" content="website">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="assets/site.css">
  <script src="assets/site.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="index.html" aria-label="ChapterOne handbook home"><span class="brand-mark" aria-hidden="true">1</span><span>ChapterOne<small>The handbook</small></span></a>
    <div class="header-actions"><button class="search-trigger" type="button" hidden><span aria-hidden="true">⌕</span><span>Search the handbook</span><kbd>/</kbd></button><a class="header-download" href="${config.repository}/releases">Get the app <span aria-hidden="true">↗</span></a><button class="theme-toggle" type="button" hidden aria-label="Switch to dark theme">◐</button><button class="menu-toggle" type="button" hidden aria-expanded="false" aria-controls="site-nav">Guides <span aria-hidden="true">☰</span></button></div>
  </header>
  <div class="site-layout">
    <nav class="site-nav" id="site-nav" aria-label="Handbook">${navHtml(config.pages, page.slug)}<div class="nav-foot">Made for the writing.<br><a href="${config.repository}">View on GitHub <span aria-hidden="true">↗</span></a></div></nav>
    <main id="main" tabindex="-1" class="page-main${home ? ' home-page' : ''}">
      <div class="page-eyebrow">${escape(page.section)} <span aria-hidden="true">/</span> ${home ? 'A place to begin' : escape(page.nav)}</div>
      <header class="page-header${home ? ' home-hero' : ''}">
        <div><p class="eyebrow">${home ? 'From an idea to a book of your own' : 'ChapterOne handbook'}</p><h1>${home ? 'Your next chapter<br>starts here.' : escape(page.title)}</h1><p class="page-description">${escape(page.description)}</p>${home ? '<div class="hero-actions"><a class="button-primary" href="quickstart.html">Write your first book <span aria-hidden="true">→</span></a><a class="button-secondary" href="install.html">Install ChapterOne</a></div><p class="hero-note">macOS & Windows <span aria-hidden="true">·</span> Your providers <span aria-hidden="true">·</span> Your local library</p>' : ''}</div>
        ${home ? '<div class="hero-art" aria-hidden="true"><div class="book-back"></div><div class="book-front"><span class="cover-kicker">A little room<br>for a big idea</span><span class="cover-title">It begins<br>with one<br>chapter.</span><span class="cover-line"></span><span class="cover-foot">YOUR STORY, IN THE MAKING</span></div><span class="art-caption">01 — A beginning</span></div>' : ''}
      </header>
      ${toc.length ? `<details class="mobile-toc"><summary>On this page</summary><ul>${toc.map((heading) => `<li><a href="#${escape(heading.id)}">${escape(heading.text)}</a></li>`).join('')}</ul></details>` : ''}
      <article class="prose">${rendered.html}</article>
      <nav class="page-pagination" aria-label="Adjacent guides">${pageLink(previous, 'Previous')}${pageLink(next, 'Next')}</nav>
      <footer class="page-footer"><a href="${config.repository}/blob/main/${source}">Edit this guide <span aria-hidden="true">↗</span></a><span>Handbook for ${escape(version)} · <a href="${config.repository}/blob/main/LICENSE">MIT licensed</a></span></footer>
    </main>
    <aside class="page-toc" aria-label="On this page"><p>On this page</p><nav>${toc.map((heading) => `<a href="#${escape(heading.id)}">${escape(heading.text)}</a>`).join('')}</nav><div class="toc-help"><span>A little stuck?</span><a href="troubleshooting.html">Find a way forward <span aria-hidden="true">→</span></a></div></aside>
  </div>
  <dialog class="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Find your next step</h2><button class="search-close" type="button" aria-label="Close search">Esc</button></div><label class="search-label" for="search-input">Search all guides</label><input type="search" id="search-input" autocomplete="off" placeholder="Try ‘restore a chapter’ or ‘Gemini’" aria-describedby="search-status"><p id="search-status" role="status" aria-live="polite">Type a few words to search the handbook.</p><ol id="search-results"></ol><p class="search-privacy">Search stays in your browser. No account, no tracking.</p></dialog>
</body>
</html>\n`;
}

function validateSite(output) {
  const files = fs.readdirSync(output).filter((name) => name.endsWith('.html'));
  const cache = new Map();
  const idsFor = (filename) => {
    if (!cache.has(filename)) cache.set(filename, new Set([...fs.readFileSync(filename, 'utf8').matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
    return cache.get(filename);
  };
  const failures = [];
  for (const filename of files) {
    const file = path.join(output, filename);
    const html = fs.readFileSync(file, 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    if (new Set(ids).size !== ids.length) failures.push(`${filename}: duplicate element ID`);
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|data:)/i.test(href)) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) { failures.push(`${filename}: unsafe URL ${href}`); continue; }
      const [pathname, rawHash] = href.split('#');
      let destination;
      let hash;
      try { destination = path.resolve(output, decodeURIComponent(pathname || filename)); hash = rawHash && decodeURIComponent(rawHash); }
      catch (_) { failures.push(`${filename}: malformed URL ${href}`); continue; }
      if (!destination.startsWith(`${path.resolve(output)}${path.sep}`) || !fs.existsSync(destination) || !fs.statSync(destination).isFile()) {
        failures.push(`${filename}: missing/unsafe local target ${href}`);
      } else if (hash && destination.endsWith('.html') && !idsFor(destination).has(hash)) {
        failures.push(`${filename}: missing anchor ${href}`);
      }
    }
  }
  if (failures.length) throw new Error(`Documentation link check failed:\n${failures.join('\n')}`);
  return files.length;
}

function buildSite(output = path.join(SITE, 'dist')) {
  const config = JSON.parse(fs.readFileSync(path.join(SITE, 'site.json'), 'utf8'));
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const slugs = new Set();
  for (const page of config.pages) {
    if (!/^[a-z0-9-]+$/.test(page.slug) || slugs.has(page.slug)) throw new Error(`Invalid/duplicate page slug: ${page.slug}`);
    slugs.add(page.slug);
  }
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(path.join(SITE, 'assets'), path.join(output, 'assets'), { recursive: true });
  const entries = [];
  for (const page of config.pages) {
    const source = resolvePageSource(page);
    const rendered = renderMarkdown(fs.readFileSync(source, 'utf8'), source, config.pages, config.repository);
    fs.writeFileSync(path.join(output, `${page.slug}.html`), pageHtml(page, rendered, config, version));
    entries.push({ title: page.title, description: page.description, section: page.section, url: `${page.slug}.html`, text: rendered.text });
  }
  fs.writeFileSync(path.join(output, 'search-index.json'), `${JSON.stringify(entries)}\n`);
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  const notFound = { slug: '404', source: 'index.md', title: 'This page is still unwritten', nav: 'Page not found', section: 'Find your way', description: 'The guide may have moved. Start with the handbook or search for the topic you need.' };
  // GitHub can serve 404.html for nested URLs: absolute site-root links avoid broken relative assets there.
  const fallback = pageHtml(notFound, { html: '<p><a href="index.html">Return to the handbook</a> or visit <a href="troubleshooting.html">Troubleshooting</a>. If a handbook link brought you here, please report the broken link.</p>', headings: [] }, config, version)
    .replace(/\b(href|src)="((?!https?:|mailto:|#)[^"]+)"/g, (_, attribute, url) => `${attribute}="${config.url}/${url}"`);
  fs.writeFileSync(path.join(output, '404.html'), fallback);
  const count = validateSite(output);
  return { output, pages: config.pages.length, htmlFiles: count };
}

if (require.main === module) {
  try {
    const result = buildSite();
    console.log(`Built and checked ${result.pages} handbook pages + 404 at ${path.relative(ROOT, result.output)}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildSite, validateSite, headingId, renderMarkdown, rewriteLink, resolvePageSource };
