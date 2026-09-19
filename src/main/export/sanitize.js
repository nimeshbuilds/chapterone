'use strict';

const sanitizeHtml = require('sanitize-html');

/** A book can contain prose, tables and resolved illustrations, never active UI. */
function sanitizeBookHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'pre', 'code', 'strong', 'em', 'b', 'i', 's', 'del', 'sub', 'sup',
      'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'figure', 'figcaption', 'img', 'section', 'div', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'title'], img: ['src', 'alt', 'title', 'loading'],
      ol: ['start'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'],
      figure: ['class'], section: ['class'], code: ['class'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    allowedClasses: { figure: ['figure'], section: ['credits'], code: [/^language-[\w-]+$/] },
    transformTags: {
      a: (_tag, attrs) => {
        const href = attrs.href || '';
        if (!/^(https?:\/\/|mailto:|#[\w-]+$)/i.test(href)) delete attrs.href;
        return { tagName: 'a', attribs: attrs };
      },
      img: (_tag, attrs) => {
        // No remote images, SVG documents, file URLs, or arbitrary relative paths.
        const safe = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(attrs.src || '')
          || /^images\/[\w-]+\.(?:png|jpe?g|gif|webp)$/i.test(attrs.src || '');
        return { tagName: 'img', attribs: safe ? attrs : {} };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  });
}

module.exports = { sanitizeBookHtml };
