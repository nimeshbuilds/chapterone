'use strict';

/**
 * Typographic cleanup so the finished book reads like a professionally typeset
 * title — never like raw model output. Two goals the user cares about:
 *   1. NO em/en dashes (the AI "—" tell). They become commas; real compound
 *      hyphens (state-of-the-art) are preserved.
 *   2. No stray markdown characters leaking into the rendered/exported book,
 *      and proper curly quotes.
 *
 * `tidyProse` is line-aware so it preserves legitimate Markdown structure
 * (headings, lists, image markers, fenced code) that the renderer/exporters rely on.
 */

const CODE = ''; // private-use sentinel (never in prose) to shield code spans

/** Replace em/en dashes (and `--`) with commas; keep word-joining hyphens AND
 *  en dashes inside numeric ranges (1914–1918, pages 12–15, 3–5). */
function stripDashes(s) {
  return String(s == null ? '' : s)
    // protect digit–digit ranges before the clause-break pass
    .replace(/(\d)\s*–\s*(\d)/g, `$1${CODE}NDASH${CODE}$2`)
    // " — " / "—" / " – " / "--" used as a clause break → comma
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*--\s*/g, ', ')
    // tidy artifacts: ", ," → ",", " ," → ",", multiple spaces
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,(?=\S)/g, ', ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(new RegExp(`${CODE}NDASH${CODE}`, 'g'), '–');
}

/** Straight quotes/apostrophes → curly, without touching code or URLs. */
function curlyQuotes(s) {
  return String(s == null ? '' : s)
    // apostrophes in contractions/possessives: letter ' letter|end
    .replace(/(\w)'(\w)/g, '$1’$2')
    .replace(/(\w)'/g, '$1’')
    // opening single quote
    .replace(/'(?=\w)/g, '‘')
    // double quotes: opening before a word, closing otherwise
    .replace(/"(?=\S)/g, '“')
    .replace(/"/g, '”');
}

/** Short-string cleanup: titles, subtitle, premise, chapter titles. */
function tidyText(s) {
  if (s == null) return s;
  return curlyQuotes(stripDashes(String(s)))
    .replace(/[*_`#]+/g, '') // no markdown symbols in a title
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Is this line a Markdown image marker we must leave intact? e.g. ![cap](bwimg:x) */
function isImageLine(line) {
  return /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line);
}
/** Is this a horizontal-rule line (---, ***, ___)? */
function isRuleLine(line) {
  return /^\s*([-*_])\1{2,}\s*$/.test(line);
}

/**
 * Clean a full chapter's Markdown while preserving structure the exporters use.
 */
function tidyProse(markdown) {
  const lines = String(markdown == null ? '' : markdown).split('\n');
  const out = [];
  let inFence = false;
  for (const raw of lines) {
    // Preserve fenced code blocks verbatim — keep the ``` markers AND the code
    // inside untouched (no dash/quote/backtick munging) so they render as code.
    if (/^\s*```/.test(raw)) { inFence = !inFence; out.push(raw); continue; }
    if (inFence) { out.push(raw); continue; }
    if (isRuleLine(raw)) { out.push(''); continue; }          // remove dash/star rules
    if (isImageLine(raw)) { out.push(raw.trim()); continue; } // keep image markers verbatim

    const headingMatch = raw.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      // Clean the text but PRESERVE the heading level — flattening ##/### to #
      // destroyed the document structure of nonfiction books.
      out.push(`${headingMatch[1]} ${tidyText(headingMatch[2])}`);
      continue;
    }
    const listMatch = raw.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/);
    if (listMatch) {
      // This prefix contains exactly one Markdown marker, never prose. Build
      // unordered markers directly rather than treating it as sanitization.
      const prefix = listMatch[1];
      const marker = prefix.trim();
      const normalized = marker === '*' || marker === '+'
        ? prefix.slice(0, prefix.indexOf(marker)) + '-' + prefix.slice(prefix.indexOf(marker) + 1)
        : prefix;
      out.push(normalized + cleanInline(listMatch[2]));
      continue;
    }
    out.push(cleanInline(raw));
  }
  return collapseBlankRuns(out.join('\n')).trim() + '\n';
}

/** Inline cleanup for a normal prose line. */
function cleanInline(line) {
  // Shield inline `code` spans, markdown link targets `](…)`, and bare URLs with
  // a private-use sentinel so dash/quote tidying never mangles them
  // (example.com/a--b and (https://…) must survive verbatim).
  const spans = [];
  const shield = (m) => { spans.push(m); return CODE + (spans.length - 1) + CODE; };
  let s = String(line)
    .replace(/`[^`]+`/g, shield)
    .replace(/\]\([^)\s]+\)/g, shield)
    .replace(/https?:\/\/[^\s)\]]+/g, shield);
  s = stripDashes(s);
  s = s.replace(/\*{3,}/g, '');                   // stray *** decoration
  // (balanced **bold**/*italic* are left for the Markdown renderer)
  s = curlyQuotes(s);
  s = s.replace(new RegExp(CODE + '(\\d+)' + CODE, 'g'), (_, i) => spans[+i]); // restore shielded spans
  return s.replace(/[ \t]+$/g, '');
}

/** Collapse 3+ blank lines down to a single blank line. */
function collapseBlankRuns(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Convert a chapter's Markdown to clean, speakable plain text for TTS:
 * strip heading markers, emphasis, links, image markers, and code blocks;
 * speak the chapter title first.
 */
function markdownToSpeech(markdown) {
  const lines = String(markdown == null ? '' : markdown).split('\n');
  const parts = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; } // skip code fence + content
    if (inFence) continue;
    if (isRuleLine(line) || isImageLine(line)) continue;
    let s = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')           // heading markers
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links → text
      .replace(/[*_`]+/g, '')                       // emphasis/code
      .trim();
    s = curlyQuotes(stripDashes(s));
    if (s) parts.push(s);
  }
  return parts.join('\n').replace(/\n{2,}/g, '\n').trim();
}

module.exports = { tidyProse, tidyText, markdownToSpeech, stripDashes, curlyQuotes };
