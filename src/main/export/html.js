'use strict';

const fs = require('fs');
const { marked } = require('marked');
const { svgToDataUri } = require('../book/aiArt');
const { cssForBand } = require('../book/ageBands');
const { tidyProse } = require('../book/typography');
const { sanitizeBookHtml } = require('./sanitize');

marked.setOptions({ mangle: false, headerIds: true, headerPrefix: 'h-' });

/** Read an on-disk image file into a data URI (for self-contained HTML/PDF). */
function fileToDataUri(file, mime) {
  try { return `data:${mime || 'image/png'};base64,` + fs.readFileSync(file).toString('base64'); }
  catch (_) { return null; }
}

/** Default bwimg resolver built from a book's on-disk images[]. */
function defaultResolver(book) {
  const map = new Map();
  for (const im of book.images || []) {
    if (im && im.file && fs.existsSync(im.file)) {
      const uri = fileToDataUri(im.file, im.mime || 'image/jpeg');
      if (uri) map.set(im.id, uri);
    }
  }
  return (id) => map.get(id) || null;
}

/** A figure for an on-disk PNG/JPEG art file. */
function rasterFigure(file, cls = 'chapter-art') {
  if (!file || !fs.existsSync(file)) return '';
  const uri = fileToDataUri(file, 'image/png');
  return uri ? `<figure class="${cls}"><img src="${uri}" alt="" /></figure>` : '';
}

/** Wrap a sanitized SVG string as a static <img> figure (no script execution). */
function svgFigure(svg, cls = 'chapter-art') {
  const uri = svgToDataUri(svg);
  if (!uri) return '';
  return `<figure class="${cls}"><img src="${uri}" alt="" /></figure>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace internal `bwimg:ID` image references with a polished, captioned
 * <figure>. `resolve(id)` returns a usable src (data URL or relative path) or
 * null to drop the image entirely.
 */
function applyImageSources(html, resolve) {
  return html.replace(/<img\b[^>]*\bsrc="bwimg:([^"]+)"[^>]*>/gi, (full, id) => {
    const src = resolve ? resolve(id) : null;
    if (!src) return ''; // unresolved → drop so nothing looks broken
    const altMatch = full.match(/\balt="([^"]*)"/i);
    const alt = altMatch ? altMatch[1] : '';
    return `<figure class="figure"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />${
      alt ? `<figcaption>${alt}</figcaption>` : ''
    }</figure>`;
  });
}

/** Convert a single chapter's Markdown to HTML. Typography is tidied at render
 * time too, so even books written before the cleanup land flawless everywhere.
 * When `number` is given, the chapter's title heading is prefixed with
 * "Chapter N:" so it's always clear which chapter you're reading. */
function chapterToHtml(markdown, resolveImage, number) {
  let md = tidyProse(markdown || '');
  if (number != null) {
    md = md.replace(/^(\s{0,3})#[ \t]+(.+)$/m, (full, sp, title) =>
      /^chapter\b/i.test(title.trim()) ? `${sp}# ${title}` : `${sp}# Chapter ${number}: ${title}`);
  }
  return sanitizeBookHtml(applyImageSources(marked.parse(md), resolveImage));
}

const BOOK_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    line-height: 1.75;
    font-size: 1.06rem;
    color: #1b1b1b;
    background: #fbf8f2;
    margin: 0;
  }
  .page { max-width: 40rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
  h1 { font-size: 1.95rem; line-height: 1.25; margin: 2.5rem 0 1.2rem; font-weight: 700; }
  h2 { font-size: 1.4rem; margin: 2rem 0 1rem; }
  h3 { font-size: 1.15rem; margin: 1.6rem 0 .8rem; }
  p { margin: 0 0 1.1rem; text-align: justify; hyphens: auto; }
  p + p { text-indent: 1.4em; margin-top: -0.2rem; }
  blockquote { border-left: 3px solid #c9a14a; margin: 1.4rem 0; padding: .2rem 1.2rem; color: #4a4a4a; font-style: italic; }
  em { font-style: italic; }
  code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: .88em; background: rgba(0,0,0,.06); padding: .1em .35em; border-radius: 4px; }
  pre { background: #f5f4f1; border: 1px solid rgba(0,0,0,.10); border-radius: 8px; padding: .9rem 1.1rem; overflow-x: auto; margin: 1.3rem 0; line-height: 1.45; page-break-inside: avoid; break-inside: avoid; }
  pre code { background: none; padding: 0; font-size: .82rem; white-space: pre; }
  img { max-width: 100%; height: auto; border-radius: 6px; display: block; margin: 0 auto; }
  figure.figure { margin: 2rem 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
  figure.figure img { box-shadow: 0 6px 22px rgba(0,0,0,.16); }
  figcaption { font-size: .82rem; color: #6a6a6a; text-align: center; margin: .7rem auto 0; font-style: italic; max-width: 90%; }
  .img-credit { font-size: .8rem; color: #6a6a6a; text-align: center; font-style: italic; }
  hr { border: none; text-align: center; margin: 2rem 0; }
  hr::before { content: '* * *'; letter-spacing: .6em; color: #b08a3e; }
  .titlepage { text-align: center; padding: 6rem 1.5rem; }
  .titlepage .title { font-size: 2.6rem; font-weight: 700; line-height: 1.1; }
  .titlepage .subtitle { font-size: 1.3rem; color: #5a5a5a; margin-top: 1rem; font-style: italic; }
  .titlepage .author { margin-top: 3rem; font-size: 1.1rem; letter-spacing: .12em; text-transform: uppercase; }
  .titlepage .dedication { margin-top: 4rem; font-style: italic; color: #6a6a6a; font-size: 1.02rem; }
  .backpage { page-break-before: always; }
  .backpage .blurb { max-width: 32rem; margin: 1.4rem auto 0; font-size: 1.05rem; line-height: 1.7; text-align: center; font-style: italic; }
  .chapter { page-break-before: always; }
  .cover-page { page-break-after: always; text-align: center; margin: 0; padding: 0; }
  .cover-art img, .cover-page img { max-width: 100%; max-height: 100vh; border-radius: 4px; }
  .chapter-art { margin: 0 0 1.6rem; text-align: center; }
  .chapter-art img { max-width: 100%; border-radius: 8px; }
  .credits { page-break-before: always; font-size: .9rem; color: #444; }
  .credits h2 { font-size: 1.2rem; }
  .credits li { margin-bottom: .6rem; }
`;

/** Build the image-credits HTML (attribution for every sourced image). */
function creditsHtml(book) {
  const imgs = (book.images || []).filter((im) => im && im.attribution);
  if (!imgs.length) return '';
  const items = imgs
    .map((im) => {
      const lic = im.licenseUrl
        ? `<a href="${escapeHtml(im.licenseUrl)}">${escapeHtml((im.license || '').toUpperCase())}</a>`
        : escapeHtml((im.license || '').toUpperCase());
      const link = im.landing ? `<a href="${escapeHtml(im.landing)}">source</a>` : '';
      return `<li>${escapeHtml(im.caption || im.query)} — ${escapeHtml(im.attribution)} ${lic ? `(License: ${lic})` : ''} ${link}</li>`;
    })
    .join('\n');
  return sanitizeBookHtml(`<section class="credits"><h2>Image Credits</h2><p>The following images are used under open licenses:</p><ul>${items}</ul></section>`);
}

/**
 * Build a single self-contained HTML document for the whole book.
 * @param {object} opts
 * @param {(id:string)=>string|null} [opts.resolveImage] map bwimg ids to src
 */
function bookToHtml(book, opts = {}) {
  const resolveImage = opts.resolveImage || defaultResolver(book);
  // Prefer the rasterized PNG (covers artHtml chapters too, whose only
  // renderable form is the PNG), then fall back to inline SVG.
  const chapterArt = (c) => (c.artFile ? rasterFigure(c.artFile) : c.artSvg ? svgFigure(c.artSvg) : '');
  const chapters = (book.chapters || [])
    .filter(Boolean)
    .map(
      (c) =>
        `<section class="chapter" id="ch-${c.number}">${chapterArt(c)}${chapterToHtml(c.content, resolveImage, c.number)}</section>`
    )
    .join('\n');
  const coverPage = book.coverPng
    ? `<section class="cover-page">${rasterFigure(book.coverPng, 'cover-art')}</section>`
    : book.coverSvg
      ? `<section class="cover-page">${svgFigure(book.coverSvg, 'cover-art')}</section>`
      : '';

  const title = `${escapeHtml(book.title)}${book.subtitle ? ` — ${escapeHtml(book.subtitle)}` : ''}`;
  const titlePage = `
    <section class="titlepage">
      <div class="title">${escapeHtml(book.title)}</div>
      ${book.subtitle ? `<div class="subtitle">${escapeHtml(book.subtitle)}</div>` : ''}
      <div class="author">by ${escapeHtml(book.author || 'Anonymous')}</div>
      ${book.dedication ? `<div class="dedication">${escapeHtml(book.dedication)}</div>` : ''}
    </section>`;
  const backPage = book.blurb ? `
    <section class="titlepage backpage">
      <div class="subtitle" style="text-transform:uppercase;letter-spacing:.14em;font-size:.85rem">About this book</div>
      <p class="blurb">${escapeHtml(book.blurb)}</p>
    </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${BOOK_CSS}${cssForBand(book.ageBand)}${opts.extraCss || ''}</style>
</head>
<body>
<div class="page">
${coverPage}
${opts.includeTitlePage === false ? '' : titlePage}
${chapters}
${backPage}
${opts.includeCredits === false ? '' : creditsHtml(book)}
</div>
</body>
</html>`;
}

module.exports = { bookToHtml, chapterToHtml, svgFigure, escapeHtml, applyImageSources, creditsHtml, BOOK_CSS };
