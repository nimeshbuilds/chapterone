'use strict';

const { randomUUID } = require('crypto');
const { tidyProse } = require('./typography');

const REVISION_LIMIT = 20;
const REASONS = new Set(['manual-edit', 'ai-rewrite', 'restore']);
const REVISION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function chapterAt(book, index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid chapter index.');
  const chapter = Array.isArray(book.chapters) && book.chapters[index];
  if (!chapter || typeof chapter !== 'object' || typeof chapter.content !== 'string') {
    throw new Error('No such written chapter.');
  }
  return chapter;
}

function historyOf(chapter) {
  if (chapter.revisions == null) return [];
  if (!Array.isArray(chapter.revisions) || chapter.revisions.some((item) =>
    !item || typeof item.id !== 'string' || !REVISION_ID.test(item.id)
    || typeof item.content !== 'string' || typeof item.createdAt !== 'string'
    || !REASONS.has(item.reason))) {
    // Do not overwrite unreadable history and silently lose the saved drafts.
    throw new Error('The saved revision history could not be read. Your book file has been preserved.');
  }
  return chapter.revisions;
}

function chapterSnapshot(book, index) {
  const chapter = chapterAt(book, index);
  return { content: chapter.content, title: String(chapter.title || ''),
    words: (chapter.content.match(/\S+/g) || []).length };
}

function metadata(revision) {
  return { id: revision.id, createdAt: revision.createdAt, reason: revision.reason,
    title: revision.title, words: revision.words, characters: revision.content.length };
}

/** Save the previous prose only when an edit actually changed it. */
function recordChapterRevision(book, index, previous, reason) {
  const chapter = chapterAt(book, index);
  if (!REASONS.has(reason)) throw new Error('Invalid revision reason.');
  if (!previous || typeof previous.content !== 'string') throw new Error('Invalid chapter snapshot.');
  const history = historyOf(chapter);
  if (chapter.content === previous.content) return false;
  chapter.revisions = [{ id: randomUUID(), createdAt: new Date().toISOString(), reason,
    content: previous.content, title: String(previous.title || ''),
    words: (previous.content.match(/\S+/g) || []).length }, ...history].slice(0, REVISION_LIMIT);
  return true;
}

function recountBook(book) {
  book.words = book.chapters.reduce((total, chapter) => total +
    (chapter && typeof chapter.content === 'string' ? (chapter.content.match(/\S+/g) || []).length : 0), 0);
}

function updateChapterContent(book, index, content, reason = 'manual-edit') {
  if (typeof content !== 'string') throw new Error('Chapter content must be text.');
  if (!REASONS.has(reason)) throw new Error('Invalid revision reason.');
  const chapter = chapterAt(book, index);
  // Validate history before modifying even an in-memory copy.
  historyOf(chapter);
  if (content === chapter.content) return false;
  const previous = chapterSnapshot(book, index);
  const nextContent = tidyProse(content);
  if (nextContent === chapter.content) return false;
  chapter.content = nextContent;
  recordChapterRevision(book, index, previous, reason);
  chapter.words = (chapter.content.match(/\S+/g) || []).length;
  recountBook(book);
  return true;
}

function listChapterRevisions(book, index) {
  return { limit: REVISION_LIMIT, revisions: historyOf(chapterAt(book, index)).map(metadata) };
}

function getChapterRevision(book, index, revisionId) {
  if (typeof revisionId !== 'string' || !REVISION_ID.test(revisionId)) throw new Error('Invalid revision id.');
  const revision = historyOf(chapterAt(book, index)).find((item) => item.id === revisionId);
  if (!revision) throw new Error('That revision is no longer available. It may have reached the history limit.');
  return { ...metadata(revision), content: revision.content };
}

function restoreChapterRevision(book, index, revisionId) {
  const revision = getChapterRevision(book, index, revisionId);
  const chapter = chapterAt(book, index);
  const previous = chapterSnapshot(book, index);
  if (chapter.content === revision.content) return false;
  // Restore exact saved prose, not newly normalized text. Keep current title,
  // outline, summary and artwork: edit/rewrite history covers prose only.
  chapter.content = revision.content;
  recordChapterRevision(book, index, previous, 'restore');
  chapter.words = (chapter.content.match(/\S+/g) || []).length;
  recountBook(book);
  return true;
}

module.exports = { REVISION_LIMIT, chapterAt, chapterSnapshot, recordChapterRevision,
  updateChapterContent, listChapterRevisions, getChapterRevision, restoreChapterRevision, recountBook };
