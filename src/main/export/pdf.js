'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { bookToHtml } = require('./html');
const { configureOfflineSession } = require('../security');

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
  const { BrowserWindow, session } = require('electron');

  const html = bookToHtml(book, {
    extraCss: (opts.extraCss || '@page { margin: 2cm; }') + ' body { background: #fff; }',
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-pdf-'));
  const tmp = path.join(tmpDir, 'book.html');
  fs.writeFileSync(tmp, html);

  const offline = session.fromPartition(`pdf-${require('crypto').randomUUID()}`);
  configureOfflineSession(offline, tmp);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true, nodeIntegration: false, session: offline },
  });

  try {
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: opts.pageSize || 'A4',
      preferCSSPageSize: false,
    });
    fs.writeFileSync(outPath, data);
    return outPath;
  } finally {
    win.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Print-ready interior PDF at 6×9 in (the standard KDP/IngramSpark trade trim),
 * with book-appropriate margins baked into @page. Micron page size = exact trim.
 */
async function generatePrintPdf(book, outPath) {
  return generatePdf(book, outPath, {
    pageSize: { width: 6, height: 9 }, // printToPDF uses inches, unlike webContents.print
    extraCss: '@page { margin: 1.9cm 1.6cm; } .page { max-width: none; padding: 0; }',
  });
}

module.exports = { generatePdf, generatePrintPdf };
