'use strict';

/**
 * AI-designed vector art helpers.
 *
 * The coding CLIs can't emit raster images, but they're strong visual designers
 * and produce excellent SVG. We extract the SVG from the model's reply and
 * sanitize it hard before it's ever embedded in a book or shown in the reader.
 */

/** Pull the first <svg>…</svg> block out of a model reply. */
function extractSvg(text) {
  if (!text) return null;
  const m = String(text).match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : null;
}

/**
 * Remove anything active or external so the SVG is a safe, static graphic:
 * scripts, event handlers, foreignObject, external/raster references, and
 * javascript: URLs. Returns a cleaned SVG string, or null if it's not usable.
 */
function sanitizeSvg(svg) {
  let s = extractSvg(svg);
  if (!s) return null;

  // Drop dangerous elements entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Strip on* event handler attributes.
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  // Neutralize javascript: and external http(s) refs in href/xlink:href.
  s = s.replace(/(href|xlink:href)\s*=\s*"(?:javascript:|https?:|\/\/)[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|xlink:href)\s*=\s*'(?:javascript:|https?:|\/\/)[^']*'/gi, "$1='#'");
  // Remove raster <image> elements (they could pull external content).
  s = s.replace(/<image[\s\S]*?(?:\/>|<\/image>)/gi, '');

  // Must still be a valid-looking svg with a viewBox or width/height.
  if (!/^<svg[\s>]/i.test(s.trim())) return null;
  if (!/viewBox=|width=/i.test(s)) return null;

  // Ensure the SVG namespace is present.
  if (!/xmlns=/.test(s)) {
    s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return s.trim();
}

/** Encode an SVG string as a data URI for <img src="…"> (no script execution). */
function svgToDataUri(svg) {
  if (!svg) return null;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

/** Pull the HTML art fragment out of a model reply (tolerant of code fences). */
function extractHtmlArt(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim(); // drop fences
  const first = s.indexOf('<');
  const last = s.lastIndexOf('>');
  if (first === -1 || last === -1 || last <= first) return null;
  return s.slice(first, last + 1).trim();
}

/**
 * Harden an HTML/CSS art fragment so it renders as a safe, fully-static graphic
 * in the offscreen window: no scripts, frames, embeds, event handlers, external
 * resources, or network references. We also render with JavaScript disabled, so
 * this is defence-in-depth. Returns a cleaned fragment, or null if unusable.
 */
function sanitizeHtml(html) {
  let s = extractHtmlArt(html);
  if (!s) return null;

  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<(?:iframe|object|embed|template|audio|video|form)[\s\S]*?<\/(?:iframe|object|embed|template|audio|video|form)>/gi, '');
  s = s.replace(/<(?:iframe|object|embed|link|meta|base|source|track|param)\b[^>]*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // event handlers (quoted and unquoted)
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // neutralise javascript: / external refs in href/src/xlink:href
  s = s.replace(/(href|src|xlink:href)\s*=\s*"(?:\s*javascript:|\s*https?:|\s*\/\/)[^"]*"/gi, '$1="#"');
  s = s.replace(/(href|src|xlink:href)\s*=\s*'(?:\s*javascript:|\s*https?:|\s*\/\/)[^']*'/gi, "$1='#'");
  // neutralise external CSS resources, keep data: URIs and gradients
  s = s.replace(/url\(\s*['"]?\s*(?:https?:|\/\/)[^)]*\)/gi, 'none');
  s = s.replace(/@import[^;]+;/gi, '');

  if (!/<[a-z]/i.test(s)) return null;
  return s.trim();
}

module.exports = { extractSvg, sanitizeSvg, svgToDataUri, extractHtmlArt, sanitizeHtml };
