'use strict';

/** Make a string safe for use as a filename. */
function safeFilename(name, fallback = 'book') {
  const cleaned = String(name || '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  const result = cleaned || fallback;
  // These device names are reserved even when followed by an extension.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result;
}

module.exports = { safeFilename };
