'use strict';

const { marked } = require('marked');

marked.setOptions({ mangle: false, headerIds: true, headerPrefix: 'h-' });

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
    return `<figure class="figure"><img src="${src}" alt="${alt}" loading="lazy" />${
      alt ? `<figcaption>${alt}</figcaption>` : ''
    }</figure>`;
  });
}

/** Convert a single chapter's Markdown to HTML. */
function chapterToHtml(markdown, resolveImage) {
  return applyImageSources(marked.parse(markdown || ''), resolveImage);
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
  .chapter { page-break-before: always; }
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
  return `<section class="credits"><h2>Image Credits</h2><p>The following images are used under open licenses:</p><ul>${items}</ul></section>`;
}

/**
 * Build a single self-contained HTML document for the whole book.
 * @param {object} opts
 * @param {(id:string)=>string|null} [opts.resolveImage] map bwimg ids to src
 */
function bookToHtml(book, opts = {}) {
  const chapters = (book.chapters || [])
    .filter(Boolean)
    .map(
      (c) =>
        `<section class="chapter" id="ch-${c.number}">${chapterToHtml(c.content, opts.resolveImage)}</section>`
    )
    .join('\n');

  const title = `${escapeHtml(book.title)}${book.subtitle ? ` — ${escapeHtml(book.subtitle)}` : ''}`;
  const titlePage = `
    <section class="titlepage">
      <div class="title">${escapeHtml(book.title)}</div>
      ${book.subtitle ? `<div class="subtitle">${escapeHtml(book.subtitle)}</div>` : ''}
      <div class="author">by ${escapeHtml(book.author || 'Anonymous')}</div>
    </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${BOOK_CSS}${opts.extraCss || ''}</style>
</head>
<body>
<div class="page">
${opts.includeTitlePage === false ? '' : titlePage}
${chapters}
${opts.includeCredits === false ? '' : creditsHtml(book)}
</div>
</body>
</html>`;
}

module.exports = { bookToHtml, chapterToHtml, escapeHtml, applyImageSources, creditsHtml, BOOK_CSS };
