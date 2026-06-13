'use strict';

const fs = require('fs');
const archiver = require('archiver');
const { randomUUID } = require('crypto');
const { chapterToHtml, escapeHtml, creditsHtml, BOOK_CSS } = require('./html');
const { mimeForExt } = require('../book/images');

/** Make marked's HTML output XHTML-valid by self-closing void elements. */
function toXhtml(html) {
  return html
    .replace(/<(br|hr|img)([^>]*?)\s*\/?>/gi, (m, tag, attrs) => `<${tag}${attrs} />`)
    .replace(/&(?!#?\w+;)/g, '&amp;');
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
 * Embeds any sourced (openly-licensed) images and a Credits page.
 */
function generateEpub(book, outPath) {
  return new Promise((resolve, reject) => {
    const bookId = `urn:uuid:${randomUUID()}`;
    const title = book.title || 'Untitled';
    const author = book.author || 'Anonymous';
    const lang = 'en';
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    // Images available on disk → relative paths inside the EPUB.
    const images = (book.images || []).filter((im) => im && im.file && fs.existsSync(im.file));
    const imageById = new Map(images.map((im) => [im.id, im]));
    const resolveImage = (id) => (imageById.has(id) ? `images/${id}.${imageById.get(id).ext}` : null);

    // AI-designed SVG art (cover + per-chapter), embedded as SVG image files.
    const artFiles = []; // { name, svg }
    const chapters = (book.chapters || []).filter(Boolean).map((c, i) => {
      let artHtml = '';
      if (c.artSvg) {
        const name = `art/chapter-${i + 1}.svg`;
        artFiles.push({ id: `art-${i + 1}`, name, svg: c.artSvg });
        artHtml = `<figure class="chapter-art"><img src="${name}" alt="" /></figure>`;
      }
      return {
        id: `chapter-${i + 1}`,
        file: `chapter-${i + 1}.xhtml`,
        artId: c.artSvg ? `art-${i + 1}` : null,
        number: c.number || i + 1,
        title: c.title || `Chapter ${i + 1}`,
        xhtml: xhtmlDoc(c.title || `Chapter ${i + 1}`, artHtml + toXhtml(chapterToHtml(c.content, resolveImage))),
      };
    });
    const coverSvg = book.coverSvg || null;

    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(outPath));
    archive.on('error', reject);
    archive.pipe(output);

    archive.append('application/epub+zip', { name: 'mimetype', store: true });
    archive.append(
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      { name: 'META-INF/container.xml' }
    );

    archive.append(BOOK_CSS, { name: 'OEBPS/style.css' });

    // Cover (AI-designed SVG) + cover page.
    if (coverSvg) {
      archive.append(coverSvg, { name: 'OEBPS/cover.svg' });
      archive.append(
        xhtmlDoc('Cover', '<section class="cover-page"><img src="cover.svg" alt="Cover" /></section>'),
        { name: 'OEBPS/cover.xhtml' }
      );
    }
    // Chapter art SVG files.
    for (const a of artFiles) {
      archive.append(a.svg, { name: `OEBPS/${a.name}` });
    }

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

    for (const c of chapters) archive.append(c.xhtml, { name: `OEBPS/${c.file}` });

    // Image binaries.
    for (const im of images) {
      archive.file(im.file, { name: `OEBPS/images/${im.id}.${im.ext}` });
    }

    // Credits page (image attributions), if any.
    const creditsBody = toXhtml(creditsHtml(book));
    const hasCredits = !!creditsBody.trim();
    if (hasCredits) {
      archive.append(xhtmlDoc('Image Credits', creditsBody), { name: 'OEBPS/credits.xhtml' });
    }

    // EPUB3 nav.
    const navItems = chapters
      .map((c) => `      <li><a href="${c.file}">${escapeHtml(c.title)}</a></li>`)
      .join('\n');
    archive.append(
      `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}">
<head><meta charset="utf-8" /><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navItems}
${hasCredits ? '      <li><a href="credits.xhtml">Image Credits</a></li>' : ''}
    </ol>
  </nav>
</body>
</html>`,
      { name: 'OEBPS/nav.xhtml' }
    );

    // NCX fallback.
    const navPoints = chapters
      .map(
        (c, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeHtml(c.title)}</text></navLabel>
      <content src="${c.file}"/>
    </navPoint>`
      )
      .join('\n');
    archive.append(
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookId}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${escapeHtml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`,
      { name: 'OEBPS/toc.ncx' }
    );

    // OPF manifest + spine.
    const imageManifest = images
      .map((im) => `    <item id="${im.id}" href="images/${im.id}.${im.ext}" media-type="${mimeForExt(im.ext)}"/>`)
      .join('\n');
    const artManifest = artFiles
      .map((a) => `    <item id="${a.id}" href="${a.name}" media-type="image/svg+xml"/>`)
      .join('\n');
    const manifestItems = [
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      '    <item id="css" href="style.css" media-type="text/css"/>',
      coverSvg ? '    <item id="cover-img" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>' : '',
      coverSvg ? '    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>' : '',
      '    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
      ...chapters.map((c) => `    <item id="${c.id}" href="${c.file}" media-type="application/xhtml+xml"/>`),
      hasCredits ? '    <item id="credits" href="credits.xhtml" media-type="application/xhtml+xml"/>' : '',
      imageManifest,
      artManifest,
    ].filter(Boolean).join('\n');
    const spineItems = [
      coverSvg ? '    <itemref idref="cover"/>' : '',
      '    <itemref idref="title"/>',
      ...chapters.map((c) => `    <itemref idref="${c.id}"/>`),
      hasCredits ? '    <itemref idref="credits"/>' : '',
    ].filter(Boolean).join('\n');

    const subjects = (book.themes || [])
      .concat(book.genre ? [book.genre] : [])
      .map((s) => `    <dc:subject>${escapeHtml(s)}</dc:subject>`)
      .join('\n');

    archive.append(
      `<?xml version="1.0" encoding="utf-8"?>
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
</package>`,
      { name: 'OEBPS/content.opf' }
    );

    archive.finalize();
  });
}

module.exports = { generateEpub, toXhtml };
