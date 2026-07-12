'use strict';

/**
 * Reader-facing book statistics: word totals, reading/listening time, a trade
 * paperback page estimate, and a Flesch-Kincaid grade estimate so the writer
 * can sanity-check the prose against the intended audience (spec.ageBand).
 *
 * Pure logic, dependency-free — runs under plain `node --test`. Readability is
 * computed over prose stripped of Markdown so heading markers, emphasis
 * symbols, link URLs, image markers, and code fences never skew the counts.
 */

const READING_WPM = 230;    // average adult silent-reading speed
const LISTENING_WPM = 150;  // typical audiobook narration speed
const WORDS_PER_PAGE = 275; // trade paperback estimate

/**
 * Reduce a chapter's Markdown to countable prose: drop code fences (with
 * their contents), horizontal rules, and image markers; unwrap heading/list
 * markers, links, and emphasis so only the readable text remains.
 */
function stripMarkdown(markdown) {
  const lines = String(markdown == null ? '' : markdown).split('\n');
  const parts = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; } // fence markers + contents
    if (inFence) continue;
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) continue;           // horizontal rules
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue;    // image marker lines
    const s = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')        // heading markers
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')   // list markers
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')    // inline images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
      .replace(/[*_~`]+/g, '')                 // emphasis / inline-code markers
      .trim();
    if (s) parts.push(s);
  }
  return parts.join('\n');
}

/** Tokens that count as words: whitespace-separated, containing a letter or digit. */
function wordTokens(text) {
  return String(text == null ? '' : text)
    .split(/\s+/)
    .filter((t) => /[A-Za-z0-9]/.test(t));
}

/** Count prose words in plain (already markdown-stripped) text. */
function countWords(text) {
  return wordTokens(text).length;
}

/**
 * Estimate syllables in a single word: count vowel groups, drop the common
 * silent endings (-e, -es, -ed) while keeping the audible ones (-le as in
 * "table", -ted/-ded as in "wanted"), minimum 1. A heuristic tuned for
 * Flesch-Kincaid, not a pronunciation dictionary.
 */
function estimateSyllables(word) {
  const raw = String(word == null ? '' : word);
  const w = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return /[0-9]/.test(raw) ? 1 : 0; // bare numbers are spoken: min 1
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/([^aeiouylsxz])es$/, '$1') // silent -es ("makes"); keep -les/-ses/-xes/-zes
    .replace(/([^aeioutd])ed$/, '$1')    // silent -ed ("walked"); keep -ted/-ded ("wanted")
    .replace(/([^aeiouyl])e$/, '$1')     // silent final -e ("mate"); keep -le ("table")
    .replace(/^y/, '');                  // leading y is a consonant ("yellow")
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

/** Count sentence terminators; bare decimals like "3.5" are not boundaries. */
function countSentences(text) {
  const m = String(text == null ? '' : text).match(/[.!?]+(?=[\s"'”’)\]]|$)/g);
  return Math.max(1, m ? m.length : 0); // min 1 so unterminated prose still grades
}

/**
 * Flesch-Kincaid grade level of plain (markdown-stripped) prose, one decimal.
 * Clamped at 0 — the formula goes negative on very simple text, and a
 * negative grade means nothing to a writer. Returns null when there is no prose.
 */
function fleschKincaidGrade(text) {
  const tokens = wordTokens(text);
  if (!tokens.length) return null;
  const sentences = countSentences(text);
  let syllables = 0;
  for (const t of tokens) syllables += estimateSyllables(t);
  const grade = 0.39 * (tokens.length / sentences) + 11.8 * (syllables / tokens.length) - 15.59;
  return Math.round(Math.max(0, grade) * 10) / 10;
}

/** Human label for a grade: '≈ Grade N', 'Adult' above 12, 'Early reader' below 2. */
function gradeLabel(grade) {
  if (grade == null) return null;
  if (grade > 12) return 'Adult';
  if (grade < 2) return 'Early reader';
  return '≈ Grade ' + Math.round(grade);
}

/** Round words/wpm to whole minutes, but never show "0 min" for real prose. */
function minutesAt(words, wpm) {
  if (!words) return 0;
  return Math.max(1, Math.round(words / wpm));
}

/**
 * Compute display statistics for a book ({ title, chapters, spec, ... }).
 * Word totals prefer each chapter's stored `words` count and fall back to
 * recounting the markdown-stripped content; readability always uses the
 * actual prose. An empty/missing chapter list yields all zeros and a null grade.
 */
function bookStats(book) {
  const chapters = Array.isArray(book && book.chapters) ? book.chapters : [];
  const proseParts = [];
  let words = 0;
  for (const ch of chapters) {
    const prose = stripMarkdown(ch && ch.content);
    if (prose) proseParts.push(prose);
    const stored = ch && ch.words;
    words += (Number.isFinite(stored) && stored > 0) ? Math.round(stored) : countWords(prose);
  }
  const fkGrade = fleschKincaidGrade(proseParts.join('\n'));
  return {
    words,
    chapters: chapters.length,
    readingMinutes: minutesAt(words, READING_WPM),
    listeningMinutes: minutesAt(words, LISTENING_WPM),
    fkGrade,
    fkLabel: gradeLabel(fkGrade),
    avgWordsPerChapter: chapters.length ? Math.round(words / chapters.length) : 0,
    pages: words > 0 ? Math.ceil(words / WORDS_PER_PAGE) : 0,
  };
}

module.exports = { bookStats, fleschKincaidGrade, estimateSyllables, stripMarkdown, countWords };
