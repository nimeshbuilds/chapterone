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

/** Convert a single chapter's Markdown to HTML. */
function chapterToHtml(markdown) {
  return marked.parse(markdown || '');
}

/** Reader/print CSS shared between the in-app reader, EPUB and PDF. */
const BOOK_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    line-height: 1.7;
    font-size: 1.05rem;
    color: #1b1b1b;
    background: #fbf8f2;
    margin: 0;
  }
  .page { max-width: 40rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
  h1 { font-size: 1.9rem; line-height: 1.25; margin: 2.5rem 0 1.2rem; font-weight: 700; }
  h2 { font-size: 1.4rem; margin: 2rem 0 1rem; }
  h3 { font-size: 1.15rem; margin: 1.6rem 0 .8rem; }
  p { margin: 0 0 1.1rem; text-align: justify; hyphens: auto; }
  p + p { text-indent: 1.4em; margin-top: -0.2rem; }
  blockquote { border-left: 3px solid #c9a14a; margin: 1.4rem 0; padding: .2rem 1.2rem; color: #4a4a4a; font-style: italic; }
  em { font-style: italic; }
  hr { border: none; text-align: center; margin: 2rem 0; }
  hr::before { content: '* * *'; letter-spacing: .6em; color: #b08a3e; }
  .titlepage { text-align: center; padding: 6rem 1.5rem; }
  .titlepage .title { font-size: 2.6rem; font-weight: 700; line-height: 1.1; }
  .titlepage .subtitle { font-size: 1.3rem; color: #5a5a5a; margin-top: 1rem; font-style: italic; }
  .titlepage .author { margin-top: 3rem; font-size: 1.1rem; letter-spacing: .12em; text-transform: uppercase; }
  .chapter { page-break-before: always; }
`;

/**
 * Build a single self-contained HTML document for the whole book.
 * Used for the in-app reader and as the source for PDF rendering.
 */
function bookToHtml(book, opts = {}) {
  const chapters = (book.chapters || [])
    .map(
      (c) =>
        `<section class="chapter" id="ch-${c.number}">${chapterToHtml(c.content)}</section>`
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
</div>
</body>
</html>`;
}

module.exports = { bookToHtml, chapterToHtml, escapeHtml, BOOK_CSS };
