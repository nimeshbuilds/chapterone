'use strict';

const fs = require('fs');
const { bookToHtml } = require('./html');

/**
 * Render a book to PDF using an offscreen Electron BrowserWindow.
 * Must run in the main process.
 * @param {object} book
 * @param {string} outPath
 * @returns {Promise<string>} outPath
 */
async function generatePdf(book, outPath) {
  // Lazy-require so non-Electron contexts (tests) can load this module.
  const { BrowserWindow } = require('electron');

  const html = bookToHtml(book, {
    extraCss: '@page { margin: 2cm; } body { background: #fff; }',
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false },
  });

  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(html)
    );
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    });
    fs.writeFileSync(outPath, data);
    return outPath;
  } finally {
    win.destroy();
  }
}

module.exports = { generatePdf };
