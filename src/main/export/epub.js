'use strict';

const fs = require('fs');
const archiver = require('archiver');
const { randomUUID } = require('crypto');
const { chapterToHtml, escapeHtml, BOOK_CSS } = require('./html');

/**
 * Make marked's HTML output XHTML-valid by self-closing void elements.
 * EPUB readers (incl. Kindle's converter) require well-formed XHTML.
 */
function toXhtml(html) {
  return html
    .replace(/<(br|hr|img)([^>]*?)\s*\/?>/gi, (m, tag, attrs) => `<${tag}${attrs} />`)
    .replace(/&(?!#?\w+;)/g, '&amp;'); // escape stray ampersands
}

function xhtmlDoc(title, bodyHtml) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Generate an EPUB3 file for the given book.
 * @param {object} book
 * @param {string} outPath  Destination .epub path.
 * @returns {Promise<string>} outPath
 */
function generateEpub(book, outPath) {
  return new Promise((resolve, reject) => {
    const bookId = `urn:uuid:${randomUUID()}`;
    const title = book.title || 'Untitled';
    const author = book.author || 'Anonymous';
    const lang = 'en';
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const chapters = (book.chapters || []).map((c, i) => ({
      id: `chapter-${i + 1}`,
      file: `chapter-${i + 1}.xhtml`,
      number: c.number || i + 1,
      title: c.title || `Chapter ${i + 1}`,
      xhtml: xhtmlDoc(c.title || `Chapter ${i + 1}`, toXhtml(chapterToHtml(c.content))),
    }));

    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outPath));
    archive.on('error', reject);
    archive.pipe(output);

    // 1) mimetype MUST be first and stored (no compression).
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // 2) container.xml
    archive.append(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      { name: 'META-INF/container.xml' }
    );

    // 3) stylesheet
    archive.append(BOOK_CSS, { name: 'OEBPS/style.css' });

    // 4) title page
    const titleXhtml = xhtmlDoc(
      title,
      `<section epub:type="titlepage" class="titlepage">
        <h1 class="title">${escapeHtml(title)}</h1>
        ${book.subtitle ? `<p class="subtitle">${escapeHtml(book.subtitle)}</p>` : ''}
        <p class="author">by ${escapeHtml(author)}</p>
        ${book.premise ? `<p>${escapeHtml(book.premise)}</p>` : ''}
      </section>`
    );
    archive.append(titleXhtml, { name: 'OEBPS/title.xhtml' });

    // 5) chapters
    for (const c of chapters) {
      archive.append(c.xhtml, { name: `OEBPS/${c.file}` });
    }

    // 6) EPUB3 nav
    const navItems = chapters
      .map((c) => `      <li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`)
      .join('\n');
    const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head><meta charset="utf-8" /><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`;
    archive.append(nav, { name: 'OEBPS/nav.xhtml' });

    // 7) NCX (EPUB2 fallback — improves Kindle compatibility)
    const navPoints = chapters
      .map(
        (c, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeHtml(c.title)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`
      )
      .join('\n');
    const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
    archive.append(ncx, { name: 'OEBPS/toc.ncx' });

    // 8) OPF package manifest + spine
    const manifestItems = [
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      '    <item id="css" href="style.css" media-type="text/css"/>',
      '    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
      ...chapters.map(
        (c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`
      ),
    ].join('\n');
    const spineItems = [
      '    <itemref idref="title"/>',
      ...chapters.map((c) => `    <itemref idref="${c.id}"/>`),
    ].join('\n');

    const subjects = (book.themes || [])
      .concat(book.genre ? [book.genre] : [])
      .map((s) => `    <dc:subject>${escapeHtml(s)}</dc:subject>`)
      .join('\n');

    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeHtml(title)}</dc:title>
    <dc:creator>${escapeHtml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    ${book.premise ? `<dc:description>${escapeHtml(book.premise)}</dc:description>` : ''}
${subjects}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
    archive.append(opf, { name: 'OEBPS/content.opf' });

    archive.finalize();
  });
}

module.exports = { generateEpub, toXhtml };
