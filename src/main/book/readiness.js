'use strict';

const { stripMarkdown } = require('./stats');
const { Parser } = require('htmlparser2');

const LIMITATIONS = 'This offline check looks for missing prose, visible draft markers and repeated text. It does not verify facts, originality, permissions, continuity or publishing requirements. Review the manuscript yourself before sharing it.';
const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const excerpt = (text) => String(text).trim().replace(/\s+/g, ' ').slice(0, 180);

function hasBodyText(source) {
  let fence = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    } else if (fence && /[\p{L}\p{N}]/u.test(line)) return true;
  }
  let found = false;
  let ignoredDepth = 0;
  const ignored = new Set(['script', 'style', 'iframe', 'object', 'template']);
  const parser = new Parser({
    onopentag(name) { if (ignored.has(name)) ignoredDepth++; },
    onclosetag(name) { if (ignored.has(name)) ignoredDepth = Math.max(0, ignoredDepth - 1); },
    ontext(text) { if (!ignoredDepth && /[\p{L}\p{N}]/u.test(text)) found = true; },
  });
  parser.end(source);
  return found;
}

/** Ignore code examples when detecting draft markers or Markdown headings. */
function proseLines(content) {
  let fence = null;
  return content.split(/\r?\n/).filter((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return false;
    }
    return !fence;
  });
}

/** Deterministic evidence, never an AI quality score or a publishing guarantee. */
function bookReadiness(book) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const outline = Array.isArray(book.outline) ? book.outline : [];
  const checks = [];
  const titles = new Map();
  const paragraphs = new Map();
  let words = 0;
  const add = (id, severity, title, detail, index, evidence) => {
    checks.push({ id, severity, title, detail,
      ...(index == null ? {} : { chapterIndex: index, chapterNumber: chapters[index]?.number || index + 1,
        chapterAvailable: !!chapters[index] }),
      ...(evidence ? { excerpt: excerpt(evidence) } : {}) });
  };
  if (!String(book.title || '').trim()) add('missing-title', 'warning', 'Add a book title', 'A title helps readers identify your book in exports.');
  if (!String(book.author || '').trim()) add('missing-author', 'warning', 'Add an author name', 'Check the name you want on the title page before exporting.');
  if (!chapters.some(Boolean) && !outline.length) {
    add('no-manuscript', 'error', 'No manuscript yet', 'Write a chapter before reviewing or exporting this book.');
  }
  if (book.status === 'paused' || book.status === 'generating') {
    add('unfinished-draft', 'warning', 'Writing is not finished', 'Continue the draft or review the chapters already saved.');
  }
  for (let index = 0; index < Math.max(chapters.length, outline.length); index++) {
    const chapter = chapters[index];
    if (!chapter) {
      add(`missing-chapter-${index}`, 'error', `Chapter ${index + 1} is missing`,
        outline[index]?.title ? `The outline includes “${outline[index].title}”, but no chapter is saved.` : 'This position in the manuscript has no saved chapter.', index);
      continue;
    }
    const content = typeof chapter.content === 'string' ? chapter.content : '';
    const lines = proseLines(content);
    const prose = stripMarkdown(content);
    words += prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    // Heading-only stubs are incomplete. Code-only technical chapters are not.
    const body = content.replace(/^\s{0,3}#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    if (!hasBodyText(body)) {
      add(`empty-chapter-${index}`, 'error', 'This chapter has no prose', 'Add the chapter text; a heading or illustration alone does not contain a written chapter.', index);
    }
    const title = normalize(chapter.title);
    if (!title) add(`missing-chapter-title-${index}`, 'warning', 'Add a chapter title', 'A title makes the table of contents easier to navigate.', index);
    else if (titles.has(title)) add(`duplicate-title-${index}`, 'warning', 'A chapter title is repeated',
      `Chapter ${titles.get(title) + 1} uses the same title. Keep it if intentional, or rename this chapter.`, index, chapter.title);
    else titles.set(title, index);

    const marker = lines.find((line) => /\b(?:TODO|TBD|FIXME)\b/.test(line)
      || /\[(?:insert|add|expand|write|chapter text|placeholder)\b[^\]]*\]|\blorem ipsum\b/i.test(line));
    if (marker) add(`draft-marker-${index}`, 'warning', 'Possible draft marker', 'Review this text and replace it if it is an unfinished note or placeholder.', index, marker);
    const headings = new Set();
    let repeatedHeading;
    for (const line of lines) {
      const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      if (!match) continue;
      const heading = normalize(match[1]);
      if (heading && headings.has(heading)) { repeatedHeading = match[1]; break; }
      headings.add(heading);
    }
    if (repeatedHeading) add(`repeated-heading-${index}`, 'warning', 'A heading appears more than once',
      'Check whether this repeated heading marks an intentional section or duplicated text.', index, repeatedHeading);

    let repeatedParagraph;
    for (const paragraph of lines.join('\n').split(/\n\s*\n/)) {
      const normalized = normalize(paragraph);
      if (normalized.length < 180 || /^\s*#/.test(paragraph)) continue;
      if (paragraphs.has(normalized)) {
        repeatedParagraph = { text: paragraph, chapterIndex: paragraphs.get(normalized) };
        break;
      }
      paragraphs.set(normalized, index);
    }
    if (repeatedParagraph) add(`repeated-paragraph-${index}`, 'warning', 'A passage is repeated',
      `This passage also appears ${repeatedParagraph.chapterIndex === index ? 'earlier in this chapter' : `in Chapter ${repeatedParagraph.chapterIndex + 1}`}. Review whether the repetition is intentional.`, index, repeatedParagraph.text);
    const unresolved = lines.find((line) => /!\[[^\]]*\]\(image-search:/i.test(line));
    if (unresolved) add(`unresolved-image-${index}`, 'warning', 'An image request is unresolved',
      'This image-search marker has not become an illustration. Remove the marker or review the exported chapter.', index, unresolved);
  }
  const errors = checks.filter((check) => check.severity === 'error').length;
  const warnings = checks.length - errors;
  return { checkedAt: new Date().toISOString(), status: errors ? 'needs-attention' : warnings ? 'review' : 'clear',
    summary: { errors, warnings, chapters: chapters.filter(Boolean).length, plannedChapters: outline.length, words },
    checks, limitations: LIMITATIONS };
}

module.exports = { bookReadiness };
