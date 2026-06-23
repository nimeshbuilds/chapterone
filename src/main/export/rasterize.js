'use strict';

const fs = require('fs');
const path = require('path');

/** Read width/height from an SVG's viewBox (or width/height attrs). */
function svgSize(svg) {
  const vb = String(svg).match(/viewBox\s*=\s*"([\d.\s,-]+)"/i);
  if (vb) {
    const p = vb[1].trim().split(/[\s,]+/).map(Number);
    if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
  }
  const mw = String(svg).match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)/i);
  const mh = String(svg).match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)/i);
  if (mw && mh) return { w: Number(mw[1]), h: Number(mh[1]) };
  return { w: 1200, h: 800 };
}

function targetSize(svg, maxWidth) {
  const { w, h } = svgSize(svg);
  const scale = Math.min(1, maxWidth / w);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function htmlFor(svg, width, height) {
  return (
    '<!doctype html><meta charset="utf-8">' +
    `<style>*{margin:0;padding:0}html,body{width:${width}px;height:${height}px;overflow:hidden;background:#fff}` +
    `svg{width:${width}px;height:${height}px;display:block}</style>` +
    svg
  );
}

/**
 * Render one SVG into an (already-created) offscreen window and return a PNG
 * buffer. Reusing a single window across calls is far more reliable than
 * creating one per image.
 */
async function renderInWindow(win, svg, maxWidth) {
  const { width, height } = targetSize(svg, maxWidth);
  win.setContentSize(width, height);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlFor(svg, width, height)));
  // Let the offscreen compositor paint the new frame before capturing.
  await delay(350);
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  if (!png || png.length < 100) throw new Error('Empty raster');
  return png;
}

function makeWindow() {
  const { BrowserWindow } = require('electron');
  return new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    useContentSize: true,
    webPreferences: { offscreen: true, javascript: false },
  });
}

/** Wrap a sanitized HTML/CSS art fragment in a fixed-size document. */
function htmlDocFor(fragment, width, height) {
  return (
    '<!doctype html><meta charset="utf-8">' +
    `<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden;background:#fff}` +
    `body>*{width:${width}px;height:${height}px}</style>` +
    fragment
  );
}

/** Render a hybrid HTML/CSS + inline-SVG art fragment to a PNG buffer. */
async function renderHtmlInWindow(win, fragment, width, height) {
  win.setContentSize(width, height);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlDocFor(fragment, width, height)));
  // HTML art can be heavier (gradients, blur, many nodes) — give it a touch longer.
  await delay(450);
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  if (!png || png.length < 100) throw new Error('Empty raster');
  return png;
}

/** Rasterize a single SVG string to a PNG buffer. Main-process only. */
async function rasterizeSvg(svg, opts = {}) {
  const win = makeWindow();
  try {
    return await renderInWindow(win, svg, opts.maxWidth || 1000);
  } finally {
    try { win.destroy(); } catch (_) { /* ignore */ }
  }
}

/** Rasterize a single HTML/CSS art fragment to a PNG buffer. Main-process only. */
async function rasterizeHtml(fragment, { width = 1200, height = 750 } = {}) {
  const win = makeWindow();
  try {
    return await renderHtmlInWindow(win, fragment, width, height);
  } finally {
    try { win.destroy(); } catch (_) { /* ignore */ }
  }
}

/**
 * Rasterize a book's AI-designed SVG art (cover + per-chapter) to PNG files,
 * reusing one offscreen window. Records paths on the book; any failure leaves
 * the SVG in place as a fallback.
 * @returns {Promise<object>} the same book, mutated
 */
async function rasterizeBookArt(book, imagesDir) {
  const dir = path.join(imagesDir, book.id);
  fs.mkdirSync(dir, { recursive: true });

  const jobs = [];
  // Cover: prefer the hybrid HTML design, fall back to SVG.
  if (!(book.coverPng && fs.existsSync(book.coverPng))) {
    if (book.coverHtml) jobs.push({ html: book.coverHtml, w: 1200, h: 1800, name: 'cover.png', set: (f) => { book.coverPng = f; } });
    else if (book.coverSvg) jobs.push({ svg: book.coverSvg, max: 1000, name: 'cover.png', set: (f) => { book.coverPng = f; } });
  }
  (book.chapters || []).forEach((c, i) => {
    if (!c || (c.artFile && fs.existsSync(c.artFile))) return;
    if (c.artHtml) jobs.push({ html: c.artHtml, w: 1200, h: 750, name: `chapter-${i + 1}-art.png`, set: (f) => { c.artFile = f; } });
    else if (c.artSvg) jobs.push({ svg: c.artSvg, max: 1100, name: `chapter-${i + 1}-art.png`, set: (f) => { c.artFile = f; } });
  });
  if (!jobs.length) return book;

  const win = makeWindow();
  try {
    for (const job of jobs) {
      try {
        const png = job.html
          ? await renderHtmlInWindow(win, job.html, job.w, job.h)
          : await renderInWindow(win, job.svg, job.max);
        const f = path.join(dir, job.name);
        fs.writeFileSync(f, png);
        job.set(f);
      } catch (_) { /* keep the SVG/HTML source as a fallback for this item */ }
    }
  } finally {
    try { win.destroy(); } catch (_) { /* ignore */ }
  }
  return book;
}

module.exports = { rasterizeSvg, rasterizeHtml, rasterizeBookArt, svgSize };
