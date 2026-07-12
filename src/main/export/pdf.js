'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { bookToHtml } = require('./html');

/**
 * Render a book to PDF using an offscreen Electron BrowserWindow.
 * Must run in the main process.
 *
 * The HTML is written to a temp file and loaded via file:// — a data: URL
 * hits Chromium's ~2MB URL cap, which broke every illustrated book (inline
 * base64 images easily exceed it).
 *
 * @param {object} book
 * @param {string} outPath
 * @param {object} [opts] { pageSize, extraCss } — pageSize supports 'A4',
 *   'Letter', or {width, height} in microns (for print-ready trim sizes).
 * @returns {Promise<string>} outPath
 */
async function generatePdf(book, outPath, opts = {}) {
  // Lazy-require so non-Electron contexts (tests) can load this module.
  const { BrowserWindow } = require('electron');

  const html = bookToHtml(book, {
    extraCss: (opts.extraCss || '@page { margin: 2cm; }') + ' body { background: #fff; }',
  });

  const tmp = path.join(os.tmpdir(), `chapterone-pdf-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false },
  });

  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: opts.pageSize || 'A4',
      margins: { marginType: 'default' },
    });
    fs.writeFileSync(outPath, data);
    return outPath;
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

/**
 * Print-ready interior PDF at 6×9 in (the standard KDP/IngramSpark trade trim),
 * with book-appropriate margins baked into @page. Micron page size = exact trim.
 */
async function generatePrintPdf(book, outPath) {
  return generatePdf(book, outPath, {
    pageSize: { width: 152400, height: 228600 }, // 6in × 9in in microns
    extraCss: '@page { margin: 1.9cm 1.6cm; } .page { max-width: none; padding: 0; }',
  });
}

module.exports = { generatePdf, generatePrintPdf };
