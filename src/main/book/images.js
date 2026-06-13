'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Royalty-free image sourcing.
 *
 * The model may suggest an illustration by emitting a marker on its own line:
 *     ![A snowbound Scottish village at dusk](image-search: scottish village snow dusk)
 * We resolve each marker against the Openverse API (https://openverse.org),
 * which aggregates openly-licensed media and lets us filter to public-domain
 * and Creative Commons works — no API key required. We always keep the
 * attribution and license so a Credits page can be generated.
 */

const LICENSE_PRIORITY = ['cc0', 'pdm', 'by', 'by-sa'];

/** Parse `image-search:` markers from a chapter's Markdown. */
function parseImageMarkers(markdown) {
  const re = /!\[([^\]]*)\]\(\s*image-search:\s*([^)]+?)\s*\)/gi;
  const out = [];
  let m;
  while ((m = re.exec(markdown || '')) !== null) {
    out.push({ full: m[0], caption: m[1].trim(), query: m[2].trim() });
  }
  return out;
}

/** Choose the most permissively-licensed result. */
function pickBestResult(results) {
  if (!Array.isArray(results) || !results.length) return null;
  const usable = results.filter((r) => r && r.url && r.license);
  usable.sort((a, b) => {
    const ai = LICENSE_PRIORITY.indexOf(String(a.license).toLowerCase());
    const bi = LICENSE_PRIORITY.indexOf(String(b.license).toLowerCase());
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return usable[0] || null;
}

function extFromContentType(ct, url) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('png')) return 'png';
  if (t.includes('gif')) return 'gif';
  if (t.includes('webp')) return 'webp';
  if (t.includes('svg')) return 'svg';
  const m = String(url || '').match(/\.(jpe?g|png|gif|webp|svg)(\?|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function mimeForExt(ext) {
  return {
    jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml',
  }[ext] || 'image/jpeg';
}

function httpGet(url, { json = false, maxBytes = 9_000_000, redirects = 4, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'ModulagentBookWriter/1.0', Accept: json ? 'application/json' : '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(httpGet(next, { json, maxBytes, redirects: redirects - 1, timeoutMs }));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); reject(new Error('Image too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (json) {
          try { resolve(JSON.parse(buf.toString('utf8'))); }
          catch (e) { reject(new Error('Bad JSON from ' + url)); }
        } else {
          resolve({ buffer: buf, contentType: res.headers['content-type'] || '' });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
  });
}

/** Search Openverse for an openly-licensed image. Returns metadata or null. */
async function searchOpenverse(query, { licenses = 'cc0,pdm,by,by-sa' } = {}) {
  const url =
    'https://api.openverse.org/v1/images/?' +
    new URLSearchParams({
      q: query,
      license: licenses,
      page_size: '8',
      mature: 'false',
    }).toString();
  const data = await httpGet(url, { json: true });
  const best = pickBestResult(data && data.results);
  if (!best) return null;
  return {
    title: best.title || query,
    creator: best.creator || 'Unknown',
    url: best.url,
    license: best.license,
    licenseUrl: best.license_url || '',
    source: best.source || 'openverse',
    landing: best.foreign_landing_url || '',
    attribution: best.attribution || `${best.title || query} by ${best.creator || 'Unknown'} (${(best.license || '').toUpperCase()})`,
  };
}

/**
 * Resolve every image marker in a book: search a free provider, download the
 * file, save it under `imagesDir/<bookId>/`, and rewrite the chapter markers to
 * an internal `bwimg:<id>` reference. Populates `book.images` with attribution.
 * Fully defensive: any failure simply drops that image (the caption text stays).
 *
 * @returns {Promise<object>} the same book, mutated
 */
async function resolveImagesForBook(book, { imagesDir, onProgress = () => {}, signal } = {}) {
  const dir = path.join(imagesDir, book.id);
  fs.mkdirSync(dir, { recursive: true });
  book.images = book.images || [];
  const cache = new Map(book.images.map((im) => [im.query, im]));
  let counter = book.images.length;

  for (const chapter of book.chapters || []) {
    const markers = parseImageMarkers(chapter.content);
    for (const mk of markers) {
      if (signal && signal.aborted) return book;
      let img = cache.get(mk.query);
      if (!img) {
        onProgress({ phase: 'image:search', query: mk.query });
        try {
          const meta = await searchOpenverse(mk.query);
          if (meta) {
            const dl = await httpGet(meta.url);
            const ext = extFromContentType(dl.contentType, meta.url);
            const id = `img${++counter}`;
            const file = path.join(dir, `${id}.${ext}`);
            fs.writeFileSync(file, dl.buffer);
            img = {
              id, ext, mime: mimeForExt(ext), file,
              query: mk.query, caption: mk.caption,
              creator: meta.creator, license: meta.license,
              licenseUrl: meta.licenseUrl, source: meta.source,
              landing: meta.landing, attribution: meta.attribution,
            };
            book.images.push(img);
            cache.set(mk.query, img);
          }
        } catch (_) {
          img = null; // network/provider failure → degrade gracefully
        }
      }
      if (img) {
        chapter.content = chapter.content.replace(
          mk.full,
          `![${mk.caption || img.caption || ''}](bwimg:${img.id})`
        );
      } else {
        // Drop the marker, keep the caption as plain emphasised text.
        chapter.content = chapter.content.replace(
          mk.full,
          mk.caption ? `*${mk.caption}*` : ''
        );
      }
    }
  }
  return book;
}

module.exports = {
  parseImageMarkers,
  pickBestResult,
  extFromContentType,
  mimeForExt,
  searchOpenverse,
  resolveImagesForBook,
  LICENSE_PRIORITY,
};
