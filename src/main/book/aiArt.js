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

module.exports = { extractSvg, sanitizeSvg, svgToDataUri };
