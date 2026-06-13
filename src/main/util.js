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
  return cleaned || fallback;
}

module.exports = { safeFilename };
