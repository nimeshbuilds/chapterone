'use strict';

const sanitizeMarkup = require('sanitize-html');
const { Parser } = require('htmlparser2');
const postcss = require('postcss');

const SVG_TAGS = [
  'svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse',
  'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath', 'use', 'symbol',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feComposite', 'feMerge', 'feMergeNode', 'feFlood', 'feDropShadow',
];
const SVG_ATTRIBUTES = [
  'id', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'dx', 'dy', 'transform',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing', 'preserveAspectRatio',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'fx', 'fy', 'clip-path', 'clip-rule', 'clipPathUnits', 'mask',
  'maskUnits', 'maskContentUnits', 'patternUnits', 'patternContentUnits',
  'patternTransform', 'filter', 'filterUnits', 'primitiveUnits', 'in', 'in2',
  'result', 'stdDeviation', 'mode', 'type', 'values', 'operator', 'k1', 'k2',
  'k3', 'k4', 'flood-color', 'flood-opacity', 'slope', 'intercept', 'amplitude',
  'exponent', 'tableValues', 'href', 'xlink:href', 'startOffset', 'style',
];
const SVG_COLOR = /^(?:#[a-f\d]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,%\s+-]+\)|url\(#[\w-]+\))$/i;

function cleanSvgAttributes(tagName, attribs) {
  for (const name of ['href', 'xlink:href']) {
    if (attribs[name] && !/^#[\w-]+$/.test(attribs[name])) delete attribs[name];
  }
  for (const name of ['fill', 'stroke', 'stop-color', 'flood-color']) {
    if (attribs[name] && !SVG_COLOR.test(attribs[name])) delete attribs[name];
  }
  for (const name of ['filter', 'clip-path', 'mask']) {
    if (attribs[name] && !/^(?:none|url\(#[\w-]+\))$/.test(attribs[name])) delete attribs[name];
  }
  return { tagName, attribs };
}

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
  const source = extractSvg(svg);
  if (!source) return null;
  let s = sanitizeMarkup(source, {
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    allowedTags: SVG_TAGS,
    nonTextTags: ['script', 'style', 'foreignObject', 'iframe', 'object', 'embed'],
    allowedAttributes: { '*': SVG_ATTRIBUTES },
    allowedStyles: { '*': {
      fill: [SVG_COLOR], stroke: [SVG_COLOR], color: [SVG_COLOR], 'stop-color': [SVG_COLOR],
      opacity: [/^[\d.]+$/], 'fill-opacity': [/^[\d.]+$/], 'stroke-opacity': [/^[\d.]+$/],
      'stroke-width': [/^[\d.]+(?:px)?$/], 'font-size': [/^[\d.]+(?:px|pt|em|%)?$/],
      'font-family': [/^[\w\s,'"-]+$/], 'font-weight': [/^(?:normal|bold|[1-9]00)$/],
      'font-style': [/^(?:normal|italic|oblique)$/], 'text-anchor': [/^(?:start|middle|end)$/],
    } },
    transformTags: { '*': cleanSvgAttributes },
  });
  if (!/^<svg[\s>]/.test(s.trim()) || !/\b(?:viewBox|width)=/.test(s)) return null;
  s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"');
  return s.trim();
}

/** Encode an SVG string as a data URI for <img src="…"> (no script execution). */
function svgToDataUri(svg) {
  const clean = sanitizeSvg(svg);
  if (!clean) return null;
  return 'data:image/svg+xml;base64,' + Buffer.from(clean, 'utf8').toString('base64');
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
  const source = extractHtmlArt(html);
  if (!source) return null;
  // Parse style elements separately. They are never admitted raw through the
  // HTML allowlist, because CSS is a second language with its own resources.
  const styles = [];
  let css = null;
  const parser = new Parser({
    onopentag(name) { if (name === 'style') css = ''; },
    ontext(text) { if (css !== null) css += text; },
    onclosetag(name) { if (name === 'style' && css !== null) { styles.push(cleanCss(css)); css = null; } },
  });
  parser.end(source);
  const tagNames = new Map(SVG_TAGS.map((tag) => [tag.toLowerCase(), tag]));
  const attributeNames = new Map(SVG_ATTRIBUTES.map((name) => [name.toLowerCase(), name]));
  const markup = sanitizeMarkup(source, {
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    allowedTags: [...SVG_TAGS, 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'b', 'i', 'br', 'section', 'article', 'header', 'footer', 'main',
      'figure', 'figcaption', 'ul', 'ol', 'li', 'small', 'img'],
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'template', 'textarea',
      'xmp', 'noembed', 'noframes', 'noscript', 'foreignObject'],
    allowedAttributes: { '*': [...SVG_ATTRIBUTES, 'class'], img: ['src', 'alt', 'width', 'height', 'class', 'style'] },
    allowedSchemes: [], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
    parseStyleAttributes: false, // Every style attribute is parsed by cleanCss below.
    transformTags: { '*': (name, rawAttributes) => {
      const tagName = tagNames.get(name.toLowerCase()) || name.toLowerCase();
      const attribs = Object.fromEntries(Object.entries(rawAttributes).map(([key, value]) =>
        [attributeNames.get(key.toLowerCase()) || key.toLowerCase(), value]));
      cleanSvgAttributes(tagName, attribs);
      if (attribs.style) attribs.style = cleanCss(attribs.style, true);
      if (tagName === 'img' && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(attribs.src || '')) delete attribs.src;
      return { tagName, attribs };
    } },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  }).trim();
  if (!/<[a-z]/i.test(markup)) return null;
  const sheet = styles.filter(Boolean).join('\n');
  return (sheet ? `<style>${sheet}</style>` : '') + markup;
}

const ART_CSS_PROPERTY = /^(?:--[\w-]+|(?:min-|max-)?(?:width|height)|display|position|inset(?:-[a-z]+)?|top|right|bottom|left|z-index|opacity|overflow(?:-[xy])?|box-sizing|box-shadow|text-shadow|color|background(?:-[a-z-]+)?|border(?:-[a-z-]+)?|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|font(?:-[a-z-]+)?|line-height|letter-spacing|word-spacing|white-space|text(?:-[a-z-]+)?|vertical-align|transform(?:-origin)?|filter|clip-path|fill(?:-[a-z]+)?|stroke(?:-[a-z-]+)?|stop-color|stop-opacity|flex(?:-[a-z-]+)?|grid(?:-[a-z-]+)?|gap|row-gap|column-gap|align(?:-[a-z-]+)?|justify(?:-[a-z-]+)?|order|content|isolation|mix-blend-mode)$/;
const ART_CSS_FUNCTIONS = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark',
  'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
  'matrix', 'matrix3d', 'perspective', 'rotate', 'rotatex', 'rotatey', 'rotatez', 'rotate3d',
  'scale', 'scalex', 'scaley', 'scalez', 'scale3d', 'skew', 'skewx', 'skewy',
  'translate', 'translatex', 'translatey', 'translatez', 'translate3d',
  'calc', 'min', 'max', 'clamp', 'var', 'env', 'fit-content', 'minmax', 'repeat',
  'circle', 'ellipse', 'inset', 'polygon', 'path', 'url',
]);

function safeCssValue(value) {
  // Decline escaped/obfuscated tokens as a whole instead of deleting pieces
  // that a browser could join back into a resource-loading function.
  if (value.includes('\\') || value.includes('/*') || value.includes('<') || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return false;
  for (const match of value.matchAll(/([-\w]+)\s*\(/g)) {
    if (!ART_CSS_FUNCTIONS.has(match[1].toLowerCase())) return false;
  }
  if (/\burl\s*\(/i.test(value) && !/^url\(\s*(['"]?)#[\w-]+\1\s*\)$/i.test(value.trim())) return false;
  return true;
}

/** Keep static layout/painting declarations, never imports, fonts or URLs. */
function cleanCss(source, inline = false) {
  try {
    const tree = postcss.parse(inline ? `a{${source}}` : source, { from: undefined });
    if (inline && (tree.nodes.length !== 1 || tree.first.type !== 'rule')) return '';
    tree.walkAtRules((rule) => rule.remove());
    tree.walkComments((comment) => comment.remove());
    tree.walkRules((rule) => { if (rule.selector.includes('<') || rule.selector.includes('\\')) rule.remove(); });
    tree.walkDecls((decl) => {
      if (!ART_CSS_PROPERTY.test(decl.prop) || !safeCssValue(decl.value)) decl.remove();
    });
    const result = inline ? (tree.first?.nodes || []).filter((node) => node.type === 'decl').map((node) => node.toString()).join(';') : tree.toString();
    return result.includes('<') || result.includes('\\') ? '' : result;
  } catch (_) { return ''; }
}

module.exports = { extractSvg, sanitizeSvg, svgToDataUri, extractHtmlArt, sanitizeHtml };
