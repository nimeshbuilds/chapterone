'use strict';

const path = require('path');
const { createHash } = require('crypto');
const { markdownToSpeech } = require('./typography');

/** Content-sensitive names prevent stale narration after an edit or rewrite. */
function audioCachePath(dir, chapter, voice, model) {
  const digest = createHash('sha256')
    .update(JSON.stringify([chapter.number, markdownToSpeech(chapter.content), voice, model]))
    .digest('hex');
  return path.join(dir, `${digest}.mp3`);
}

module.exports = { audioCachePath };
