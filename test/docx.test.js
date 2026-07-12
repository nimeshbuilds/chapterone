'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { exportDocx, _mdToParagraphs } = require('../src/main/export/docx');

// Enough varied prose that the deflated zip stays comfortably non-trivial.
const longChapter = Array.from(
  { length: 120 },
  (_, i) => `Sentence ${i + 1} of the aftermath drifts ${(i * 37) % 101} paces past the ${i % 2 ? 'harbour' : 'orchard'} wall.`
).join(' ');

const sampleBook = {
  id: 'b1',
  title: 'Salt & Silver <Uncut> "Edition"',
  subtitle: 'Tales of <Wonder> & Wit',
  author: "O'Brien & Sons",
  premise: 'A test book.',
  chapters: [
    {
      number: 1,
      title: 'Fire & Ice',
      content: [
        '# Fire & Ice',
        '',
        'It was **bold & brave** and *quiet*.',
        '',
        '## A Turn',
        '',
        '- first item',
        '- second item',
        '',
        '> A quote & a claim.',
        '',
        '```',
        'let x = 1 < 2;',
        '```',
        '',
        '![the old mill](bwimg:img-1)',
        '',
        'Use `fs.readFile` here.',
      ].join('\n'),
    },
    { number: 2, title: 'Aftermath', content: `# Aftermath\n\n${longChapter}` },
  ],
};

/** Find a local file header by entry name and inflate its (deflated) data. */
function readZipEntry(buf, name) {
  const sig = Buffer.from('PK\x03\x04', 'latin1');
  let off = 0;
  while ((off = buf.indexOf(sig, off)) !== -1) {
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    if (buf.slice(off + 30, off + 30 + nameLen).toString() === name) {
      const method = buf.readUInt16LE(off + 8);
      const rest = buf.slice(dataStart);
      // inflateRawSync stops at the deflate stream's terminal block, so
      // trailing zip entries after the data are ignored.
      return method === 0 ? rest : zlib.inflateRawSync(rest);
    }
    off = dataStart;
  }
  return null;
}

test('exportDocx writes a valid zip with all required parts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-docx-'));
  const out = path.join(dir, 'book.docx');
  await exportDocx(sampleBook, out);
  assert.ok(fs.existsSync(out), 'docx file should exist');
  const buf = fs.readFileSync(out);
  assert.ok(buf.length > 2000, `docx should be non-trivial (got ${buf.length} bytes)`);
  // ZIP local file header magic
  assert.strictEqual(buf.slice(0, 4).toString('latin1'), 'PK\x03\x04');
  // required parts present by name in the archive
  const whole = buf.toString('latin1');
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) {
    assert.ok(whole.includes(part), `docx should contain ${part}`);
  }
});

test('document.xml escapes the title and skips image markers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-docx-'));
  const out = path.join(dir, 'book.docx');
  await exportDocx(sampleBook, out);
  const buf = fs.readFileSync(out);
  const doc = readZipEntry(buf, 'word/document.xml').toString('utf8');
  assert.ok(doc.includes('Salt &amp; Silver &lt;Uncut&gt; &quot;Edition&quot;'), 'title should be XML-escaped');
  assert.ok(doc.includes('Tales of &lt;Wonder&gt; &amp; Wit'), 'subtitle should be XML-escaped');
  assert.ok(doc.includes('by O&apos;Brien &amp; Sons'), 'author line should be XML-escaped');
  assert.ok(!doc.includes('bwimg'), 'image markers should be skipped');
  assert.ok(!doc.includes('the old mill'), 'image captions should be skipped');
  assert.match(doc, /<w:sectPr><w:pgSz w:w="12240" w:h="15840"\/>/);
  assert.match(doc, /<w:br w:type="page"\/>/);
  // one body, balanced paragraphs
  assert.strictEqual(doc.split('<w:body>').length, 2);
  assert.strictEqual(doc.split('<w:p>').length, doc.split('</w:p>').length);
  // core.xml carries title + creator
  const core = readZipEntry(buf, 'docProps/core.xml').toString('utf8');
  assert.ok(core.includes('<dc:title>Salt &amp; Silver'));
  assert.ok(core.includes('<dc:creator>O&apos;Brien &amp; Sons</dc:creator>'));
  // styles define the book look
  const styles = readZipEntry(buf, 'word/styles.xml').toString('utf8');
  for (const s of ['Title', 'Subtitle', 'Heading1', 'Normal', 'Quote', 'Georgia']) {
    assert.ok(styles.includes(s), `styles.xml should include ${s}`);
  }
});

test('_mdToParagraphs converts bold, italic, code with escaping', () => {
  const xml = _mdToParagraphs('Hello **bold & brave** and *soft<ly>* with `a & b`.').join('');
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /bold &amp; brave/);
  assert.match(xml, /<w:i\/>/);
  assert.match(xml, /soft&lt;ly&gt;/);
  assert.match(xml, /Consolas/);
  assert.match(xml, /a &amp; b/);
});

test('_mdToParagraphs maps headings, quotes, bullets, fences; skips images', () => {
  const paras = _mdToParagraphs('# Head\n\n> Quoth the\n> raven\n\n- item one\n\n```\nx < y\n```\n\n![cap](bwimg:zzz)\n\nTail.');
  const xml = paras.join('');
  assert.match(xml, /w:val="Heading2"/, 'in-chapter # heading maps to Heading2');
  assert.match(xml, /w:val="Quote"/);
  assert.match(xml, /Quoth the raven/, 'consecutive quote lines merge');
  assert.match(xml, /•/);
  assert.match(xml, /x &lt; y/, 'fence content lands in a monospace paragraph');
  assert.ok(!xml.includes('bwimg') && !xml.includes('cap'), 'image marker skipped entirely');
  assert.match(xml, /Tail\./);
  for (const p of paras) {
    assert.ok(p.startsWith('<w:p>') && p.endsWith('</w:p>'), 'each paragraph is a well-formed <w:p>');
  }
});
