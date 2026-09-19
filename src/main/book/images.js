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
const LICENSE_SCORE = { cc0: 4, pdm: 4, by: 2, 'by-sa': 1 };

// Quality floor for a "premium book" look. Smaller images are rejected so we
// never embed a thumbnail-grade picture in a book people are meant to buy.
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 740;
const FULL_RES_PX = 2_400_000; // ~1900x1265 earns the full resolution score

/** Tokenise a search query into meaningful lowercase terms. */
function queryTerms(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Composite quality score for a candidate image, blending:
 *  - relevance (query terms found in title/tags + the provider's own ranking),
 *  - resolution (bigger, print-grade images score higher),
 *  - license permissiveness (CC0/PD preferred).
 * Higher is better.
 */
function scoreResult(r, terms, index, total) {
  const lic = LICENSE_SCORE[String(r.license || '').toLowerCase()] || 0;
  const px = (r.width || 0) * (r.height || 0);
  const resScore = px > 0 ? Math.min(px, FULL_RES_PX) / FULL_RES_PX : 0;
  const tagText = Array.isArray(r.tags) ? r.tags.map((t) => (t && t.name) || t).join(' ') : '';
  const text = `${r.title || ''} ${tagText}`.toLowerCase();
  const hits = terms.filter((t) => text.includes(t)).length;
  const relevance = terms.length ? hits / terms.length : 0;
  const orderPrior = total ? (total - index) / total : 0; // provider relevance order
  return relevance * 6 + resScore * 3 + lic * 1 + orderPrior * 0.6;
}

/**
 * Choose the best image: most relevant, highest-resolution, openly licensed.
 * @param {Array} results
 * @param {string} [query]   used for relevance scoring
 */
function pickBestResult(results, query) {
  if (!Array.isArray(results) || !results.length) return null;
  const usable = results.filter((r) => r && r.url && r.license);
  if (!usable.length) return null;
  const terms = queryTerms(query);
  const total = usable.length;
  let best = null;
  let bestScore = -Infinity;
  usable.forEach((r, i) => {
    const s = scoreResult(r, terms, i, total);
    if (s > bestScore) { bestScore = s; best = r; }
  });
  return best;
}

/** Is a candidate large enough to look good printed/full-width in a book? */
function meetsQualityBar(r) {
  // If the provider didn't report dimensions, don't assume it's bad.
  if (!r.width || !r.height) return true;
  return r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT;
}

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
    // Wikimedia (a major Openverse source) 429s generic/bot User-Agents; its
    // policy wants "<client>/<version> (<contact>)". This compliant UA gets 200.
    const ua = 'ChapterOne/1.0 (https://github.com/nimeshbuilds/chaperone; book illustration sourcing)';
    const req = lib.get(url, { headers: { 'User-Agent': ua, Accept: json ? 'application/json' : '*/*' } }, (res) => {
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

/**
 * Search Openverse for a high-quality, openly-licensed image.
 * Biases the query toward large photos, then enforces a resolution floor and
 * ranks the survivors by relevance + resolution + license. Returns null (so the
 * caller cleanly skips the image) when nothing meets the premium bar.
 */
/**
 * Openverse matches on the WHOLE query, so a long, specific phrase like
 * "data center servers cold aisle" returns zero hits while "data center servers"
 * returns dozens. Models (and our own query helper) tend to produce phrases that
 * are too specific, which is why photos were silently dropped. Generate ordered
 * fallback queries — the full phrase first, then progressively shorter prefixes,
 * then the trailing noun pair, then the single longest word — and use the first
 * that actually returns images.
 */
function queryCandidates(query) {
  const words = String(query || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [String(query || '').trim()].filter(Boolean);
  const cands = [];
  cands.push(words.join(' '));                                   // full phrase
  for (let n = words.length - 1; n >= 1; n--) cands.push(words.slice(0, n).join(' ')); // drop trailing words
  for (let n = 1; n < words.length; n++) cands.push(words.slice(n).join(' '));         // drop leading words (junk adjectives/articles)
  if (words.length >= 2) cands.push(words.slice(-2).join(' '));  // trailing noun pair
  // single most content-bearing words (longest first — proxy for the key noun)
  for (const w of words.slice().sort((a, b) => b.length - a.length).slice(0, 2)) cands.push(w);
  return [...new Set(cands)].filter(Boolean);
}

function mapResult(r, query) {
  return {
    title: r.title || query,
    creator: r.creator || 'Unknown',
    url: r.url,
    width: r.width || 0,
    height: r.height || 0,
    license: r.license,
    licenseUrl: r.license_url || '',
    source: r.source || 'openverse',
    landing: r.foreign_landing_url || '',
    attribution: r.attribution || `${r.title || query} by ${r.creator || 'Unknown'} (${(r.license || '').toUpperCase()})`,
  };
}

/**
 * Ranked list of openly-licensed candidate images for a query, best first. Tries
 * the shrink-to-fit query candidates in turn and returns the first that yields
 * any print-grade results. Returning a LIST (not just the best) lets the caller
 * fall through to the next image when a host rejects the download (e.g. Wikimedia
 * 429s a generic User-Agent), so a transient host failure never loses the photo.
 */
async function searchOpenverseRanked(query, { licenses = 'cc0,pdm,by,by-sa' } = {}) {
  for (const cand of queryCandidates(query)) {
    try {
      const url =
        'https://api.openverse.org/v1/images/?' +
        new URLSearchParams({
          q: cand,
          license: licenses,
          size: 'large',
          extension: 'jpg,png',
          page_size: '20',
          mature: 'false',
        }).toString();
      const data = await httpGet(url, { json: true });
      const results = (data && data.results) || [];
      const quality = results.filter(meetsQualityBar);
      if (!quality.length) continue;
      const terms = queryTerms(cand);
      const ranked = quality
        .filter((r) => r && r.url && r.license)
        .map((r, i) => ({ r, s: scoreResult(r, terms, i, quality.length) }))
        .sort((a, b) => b.s - a.s)
        .map(({ r }) => mapResult(r, cand));
      if (ranked.length) return ranked;
    } catch (_) { /* try the next, shorter candidate */ }
  }
  return [];
}

// Back-compat single-best helper.
async function searchOpenverse(query, opts = {}) {
  const ranked = await searchOpenverseRanked(query, opts);
  return ranked[0] || null;
}

/**
 * Resolve every image marker in a book: search a free provider, download the
 * file, save it under `imagesDir/<bookId>/`, and rewrite the chapter markers to
 * an internal `bwimg:<id>` reference. Populates `book.images` with attribution.
 * Fully defensive: any failure simply drops that image (the caption text stays).
 *
 * @returns {Promise<object>} the same book, mutated
 */
/**
 * Resolve the image markers in ONE chapter: search Openverse, download, save
 * under imagesDir/<bookId>/, rewrite each marker to a `bwimg:<id>` ref, and push
 * attribution to `book.images`. Emits `image:search` per query. Returns the
 * number of photos successfully added. Failures degrade gracefully (the marker
 * becomes plain italic caption text). This is what the generator calls per
 * chapter so a photo (and the live counter) lands as the book is written.
 */
async function resolveChapterImages(book, chapter, { imagesDir, onProgress = () => {}, signal } = {}) {
  const dir = path.join(imagesDir, book.id);
  fs.mkdirSync(dir, { recursive: true });
  book.images = book.images || [];
  const cache = new Map(book.images.map((im) => [im.query, im]));
  let counter = book.images.length;
  let added = 0;

  for (const mk of parseImageMarkers(chapter.content)) {
    if (signal && signal.aborted) break;
    let img = cache.get(mk.query);
    if (!img) {
      onProgress({ phase: 'image:search', query: mk.query });
      try {
        const candidates = await searchOpenverseRanked(mk.query);
        // Try the best images in turn; skip any that won't download (a 429/403
        // or dead link) so one flaky host doesn't cost us the photo.
        for (const meta of candidates.slice(0, 6)) {
          if (signal && signal.aborted) break;
          try {
            const dl = await httpGet(meta.url, { maxBytes: 18_000_000 });
            const ext = extFromContentType(dl.contentType, meta.url);
            const id = `img${++counter}`;
            const file = path.join(dir, `${id}.${ext}`);
            fs.writeFileSync(file, dl.buffer);
            img = {
              id, ext, mime: mimeForExt(ext), file,
              query: mk.query, caption: mk.caption,
              width: meta.width, height: meta.height,
              creator: meta.creator, license: meta.license,
              licenseUrl: meta.licenseUrl, source: meta.source,
              landing: meta.landing, attribution: meta.attribution,
            };
            book.images.push(img);
            cache.set(mk.query, img);
            break;
          } catch (_) { /* download failed → try the next candidate image */ }
        }
      } catch (_) {
        img = null; // search failure → degrade gracefully
      }
    }
    if (img) {
      chapter.content = chapter.content.replace(
        mk.full,
        `![${mk.caption || img.caption || ''}](bwimg:${img.id})`
      );
      added += 1;
    } else {
      // Drop the marker, keep the caption as plain emphasised text.
      chapter.content = chapter.content.replace(
        mk.full,
        mk.caption ? `*${mk.caption}*` : ''
      );
    }
  }
  return added;
}

/**
 * End-of-book safety net: resolve any image markers still unresolved across the
 * whole book (e.g. a resumed book, or markers the writer embedded that weren't
 * resolved inline). When everything was already resolved during writing there is
 * nothing left, so this returns immediately WITHOUT emitting — it must never
 * reset the live counter the generator already advanced.
 */
async function resolveImagesForBook(book, { imagesDir, onProgress = () => {}, signal } = {}) {
  book.images = book.images || [];
  let total = 0;
  for (const ch of book.chapters || []) total += parseImageMarkers(ch.content).length;
  if (total === 0) return book; // already resolved inline → no-op, don't touch the UI

  let used = 0;
  onProgress({ phase: 'image:added', n: 0, total });
  for (const chapter of book.chapters || []) {
    if (signal && signal.aborted) return book;
    const added = await resolveChapterImages(book, chapter, { imagesDir, onProgress, signal });
    if (added > 0) { used += added; onProgress({ phase: 'image:added', n: used, total }); }
  }
  return book;
}

module.exports = {
  parseImageMarkers,
  pickBestResult,
  scoreResult,
  meetsQualityBar,
  queryTerms,
  queryCandidates,
  extFromContentType,
  mimeForExt,
  searchOpenverse,
  searchOpenverseRanked,
  resolveChapterImages,
  resolveImagesForBook,
  LICENSE_PRIORITY,
  MIN_WIDTH,
  MIN_HEIGHT,
};
