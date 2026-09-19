'use strict';

const fs = require('fs');
const archiver = require('archiver');

// A .docx is a ZIP of OOXML parts. We hand-roll the minimal set (like the
// hand-rolled EPUB in epub.js) so no new dependencies are needed.

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const IMG_MARKER = /!\[[^\]]*\]\(bwimg:[^)]+\)/g;
const CODE_FONT = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/>';
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Escape the five XML special characters for text nodes and attributes. */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(text, rPr) {
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function para(styleId, runsXml, pPrExtra) {
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/>${pPrExtra || ''}</w:pPr>${runsXml}</w:p>`;
}

/** Convert inline Markdown (**bold**, *italic*, `code`) to <w:r> runs; image markers are dropped. */
function inlineRuns(text) {
  const parts = String(text).replace(IMG_MARKER, '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  let xml = '';
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) xml += run(part.slice(2, -2), '<w:b/>');
    else if (/^\*[^*]+\*$/.test(part)) xml += run(part.slice(1, -1), '<w:i/>');
    else if (/^`[^`]+`$/.test(part)) xml += run(part.slice(1, -1), CODE_FONT);
    else xml += run(part);
  }
  return xml || run('');
}

/** One monospace paragraph for a whole ``` fence, lines separated by soft breaks. */
function codeParagraph(lines) {
  const inner = lines.map((l) => `<w:t xml:space="preserve">${escapeXml(l)}</w:t>`).join('<w:br/>');
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:rPr>${CODE_FONT}</w:rPr>${inner}</w:r></w:p>`;
}

/**
 * Convert a chapter's Markdown (the subset our generator emits: headings,
 * paragraphs, bold/italic/code, bullets, blockquotes, fences, bwimg markers)
 * into an array of <w:p> XML strings. In-chapter `#`/`##` headings map to
 * Heading2 — Heading1 is reserved for chapter titles.
 */
function _mdToParagraphs(md) {
  const out = [];
  let text = []; // pending plain-paragraph lines
  let quote = []; // pending blockquote lines
  let fence = null; // lines collected inside a ``` fence
  const flush = () => {
    const t = text.join(' ').trim();
    if (t) out.push(para('Normal', inlineRuns(t)));
    const q = quote.join(' ').trim();
    if (q) out.push(para('Quote', inlineRuns(q)));
    text = [];
    quote = [];
  };
  for (const raw of String(md || '').split(/\r?\n/)) {
    if (fence) {
      if (/^\s*```/.test(raw)) { out.push(codeParagraph(fence)); fence = null; }
      else fence.push(raw);
      continue;
    }
    const line = raw.replace(IMG_MARKER, '').trim();
    if (/^```/.test(line)) { flush(); fence = []; continue; }
    if (!line) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push(para('Heading2', inlineRuns(heading[2]))); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flush(); continue; } // horizontal rule
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      out.push(para('Normal', run('•  ') + inlineRuns(bullet[1]), '<w:ind w:left="720" w:firstLine="0"/>'));
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { if (text.length) flush(); quote.push(q[1]); continue; }
    if (quote.length) flush();
    text.push(line);
  }
  if (fence) out.push(codeParagraph(fence)); // unterminated fence at EOF
  flush();
  return out;
}

// Book-like serif defaults: Georgia, 11pt body, 1.4 line spacing (240 * 1.4 =
// 336 twentieths), first-line indent on body paragraphs only.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="336" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="120" w:line="336" w:lineRule="auto"/><w:ind w:firstLine="360"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="240"/><w:ind w:firstLine="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/><w:ind w:firstLine="0"/></w:pPr>
<w:rPr><w:i/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr>
<w:rPr><w:i/></w:rPr>
</w:style>
</w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOC_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function coreXml(title, creator) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title)}</dc:title>
<dc:creator>${escapeXml(creator)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

/** Single trailing section: US Letter (12240x15840 twips) with 1in margins. */
const SECT_PR = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
  + '</w:sectPr>';

function documentXml(book) {
  const body = [];
  body.push(para('Title', run(book.title || 'Untitled')));
  if (book.subtitle) body.push(para('Subtitle', run(book.subtitle)));
  body.push(para('Normal', run(`by ${book.author || 'Anonymous'}`), '<w:jc w:val="center"/><w:ind w:firstLine="0"/>'));
  const chapters = (book.chapters || []).filter(Boolean);
  chapters.forEach((c, i) => {
    body.push(PAGE_BREAK);
    body.push(para('Heading1', run(c.title || `Chapter ${c.number || i + 1}`)));
    // Chapter content conventionally opens with its own "# Title" heading
    // (see markdown.js); drop it so the title isn't rendered twice.
    const content = String(c.content || '').replace(/^\s*#\s+[^\n]*\n?/, '');
    body.push(..._mdToParagraphs(content));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body.join('')}${SECT_PR}</w:body></w:document>`;
}

/**
 * Export the book as a minimal, valid Word (.docx) document.
 * Title page, then one page per chapter; Markdown content is converted to
 * styled paragraphs/runs (see _mdToParagraphs). Resolves with outPath.
 */
async function exportDocx(book, outPath) {
  const doc = documentXml(book);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(CONTENT_TYPES_XML, { name: '[Content_Types].xml' });
    archive.append(ROOT_RELS_XML, { name: '_rels/.rels' });
    archive.append(DOC_RELS_XML, { name: 'word/_rels/document.xml.rels' });
    archive.append(doc, { name: 'word/document.xml' });
    archive.append(STYLES_XML, { name: 'word/styles.xml' });
    archive.append(coreXml(book.title || 'Untitled', book.author || 'Anonymous'), { name: 'docProps/core.xml' });
    archive.finalize();
  });
  return outPath;
}

module.exports = { exportDocx, _mdToParagraphs };
