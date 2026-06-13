'use strict';

/**
 * Age bands for the Kids Books section. Each band is the single source of truth
 * for how a children's book is shaped: reading level, length, typography, and
 * how densely it should be illustrated. The same band drives the writing
 * prompts, the in-app reader font, and the EPUB/PDF export CSS.
 *
 * illustrationDensity:
 *   'every-page' — a picture on essentially every page/spread (picture books)
 *   'frequent'   — a picture every short chapter / few pages (early readers)
 *   'occasional' — a chapter-opener illustration now and then (middle grade)
 *   'none'       — text-only by default (young-adult)
 */
const AGE_BANDS = {
  '1-2': {
    key: '1-2', label: 'Ages 1–2 · Baby / Board book',
    unit: 'spread', units: 12, wordsPerUnit: 18,
    illustrationDensity: 'every-page', imagesPerUnit: 1,
    readerFontPx: 30, exportFontRem: 1.9, lineHeight: 1.7,
    readingLevel: 'pre-reading board book for babies and toddlers',
    vocab: 'a handful of very simple, concrete words; lots of repetition, rhythm, and rhyme; one short idea per spread',
    safety: 'utterly gentle and reassuring: no peril, conflict, scary imagery, or sad endings',
  },
  '3-5': {
    key: '3-5', label: 'Ages 3–5 · Picture book',
    unit: 'page', units: 16, wordsPerUnit: 45,
    illustrationDensity: 'every-page', imagesPerUnit: 1,
    readerFontPx: 24, exportFontRem: 1.55, lineHeight: 1.7,
    readingLevel: 'read-aloud picture book for preschoolers',
    vocab: 'simple sentences, playful sounds and repetition, a clear and warm story arc with a happy resolution',
    safety: 'very gentle: mild, quickly-resolved problems only; nothing frightening or upsetting',
  },
  '6-8': {
    key: '6-8', label: 'Ages 6–8 · Early reader',
    unit: 'chapter', units: 8, wordsPerUnit: 600,
    illustrationDensity: 'frequent', imagesPerUnit: 2,
    readerFontPx: 21, exportFontRem: 1.3, lineHeight: 1.65,
    readingLevel: 'early-reader / early chapter book for ages 6–8',
    vocab: 'short, decodable sentences and common vocabulary; short chapters; gentle humor and clear cause and effect',
    safety: 'age-appropriate stakes with a safe, hopeful resolution; no graphic or mature content',
  },
  '9-12': {
    key: '9-12', label: 'Ages 9–12 · Middle grade',
    unit: 'chapter', units: 12, wordsPerUnit: 1400,
    illustrationDensity: 'occasional', imagesPerUnit: 1,
    readerFontPx: 19, exportFontRem: 1.1, lineHeight: 1.65,
    readingLevel: 'middle-grade chapter book for ages 9–12',
    vocab: 'richer plot and character growth, real emotional stakes, age-appropriate themes of friendship, courage, and identity',
    safety: 'no explicit content, graphic violence, or romance beyond innocent crushes',
  },
  '13-16': {
    key: '13-16', label: 'Ages 13–16 · Young adult',
    unit: 'chapter', units: 16, wordsPerUnit: 2200,
    illustrationDensity: 'none', imagesPerUnit: 0,
    readerFontPx: 19, exportFontRem: 1.06, lineHeight: 1.7,
    readingLevel: 'young-adult novel for ages 13–16',
    vocab: 'sophisticated voice and structure; complex characters and themes handled with nuance',
    safety: 'mature themes allowed but tasteful; no explicit sexual content or gratuitous violence',
  },
  '17-18': {
    key: '17-18', label: 'Ages 17–18 · Upper YA',
    unit: 'chapter', units: 18, wordsPerUnit: 2500,
    illustrationDensity: 'none', imagesPerUnit: 0,
    readerFontPx: 19, exportFontRem: 1.06, lineHeight: 1.7,
    readingLevel: 'upper young-adult novel for ages 17–18',
    vocab: 'literary, ambitious prose; adult-adjacent themes treated with maturity',
    safety: 'frank mature themes permitted; still avoid gratuitous or explicit content',
  },
};

const DEFAULT_BAND = '6-8';
const AGE_BAND_KEYS = Object.keys(AGE_BANDS);

// Optional length the user can pick on top of the age band — scales how many
// pages/chapters the book has while keeping per-unit length age-appropriate.
const LENGTH_SCALES = { short: 0.6, standard: 1, long: 1.7 };
const KIDS_LENGTHS = [
  { key: 'short', label: 'Short' },
  { key: 'standard', label: 'Standard' },
  { key: 'long', label: 'Long' },
];

/** Effective number of pages/chapters for a band + chosen length. */
function unitsFor(specOrKey, kidsLength) {
  const b = bandOf(specOrKey);
  if (!b) return 0;
  const scale = LENGTH_SCALES[kidsLength] || 1;
  const floor = b.unit === 'chapter' ? 4 : 6;
  return Math.max(floor, Math.round(b.units * scale));
}

/** Resolve a spec, a raw band key, or an existing band object to a band def. */
function bandOf(specOrKey) {
  if (!specOrKey) return null;
  if (typeof specOrKey === 'object') {
    if (specOrKey.key && AGE_BANDS[specOrKey.key]) return specOrKey; // already a band
    return AGE_BANDS[specOrKey.ageBand || ''] || null;
  }
  return AGE_BANDS[specOrKey] || null;
}

/** Is this spec a kids book? */
function isKidsSpec(spec) {
  return !!(spec && (spec.isKids || (spec.ageBand && AGE_BANDS[spec.ageBand])));
}

/** How many illustrations chapter/unit index `i` (0-based) should get. */
function imagesForUnitIndex(specOrKey, i) {
  const b = bandOf(specOrKey);
  if (!b || b.illustrationDensity === 'none') return 0;
  if (b.illustrationDensity === 'occasional') return i % 3 === 0 ? 1 : 0; // a chapter-opener now and then
  return b.imagesPerUnit || 1; // every-page / frequent
}

/** Planned number of illustrations across a whole kids book (band + length). */
function plannedImageCount(specOrKey, kidsLength) {
  const b = bandOf(specOrKey);
  if (!b) return 0;
  const units = unitsFor(b, kidsLength);
  let n = 0;
  for (let i = 0; i < units; i++) n += imagesForUnitIndex(b, i);
  return n;
}

/**
 * Export CSS overrides (appended after BOOK_CSS / passed as extraCss) so the
 * EPUB/PDF/printed book matches the age band.
 */
function cssForBand(specOrKey) {
  const b = bandOf(specOrKey);
  if (!b) return '';
  const young = b.unit !== 'chapter';
  return [
    `body { font-family: ${young ? "'Comic Sans MS', 'Chalkboard', 'Marker Felt', " : ''}Georgia, 'Iowan Old Style', serif;`,
    `  font-size: ${b.exportFontRem}rem; line-height: ${b.lineHeight}; }`,
    `p { text-align: ${young ? 'center' : 'left'}; text-indent: 0; hyphens: none; }`,
    `p + p { text-indent: 0; margin-top: 0; }`,
    young ? `h1, h2 { text-align: center; }` : '',
    `figure, figure.chapter-art { margin: ${young ? '1.4rem' : '2rem'} auto; page-break-inside: avoid; break-inside: avoid; text-align: center; }`,
    `figure img { max-width: 100%; height: auto; }`,
  ].filter(Boolean).join('\n');
}

/** In-app reader CSS variables / attributes for a band. */
function readerVarsForBand(specOrKey) {
  const b = bandOf(specOrKey);
  if (!b) return null;
  return { fontPx: b.readerFontPx, young: b.unit !== 'chapter' };
}

module.exports = {
  AGE_BANDS, AGE_BAND_KEYS, DEFAULT_BAND, KIDS_LENGTHS, LENGTH_SCALES,
  bandOf, isKidsSpec, unitsFor, imagesForUnitIndex, plannedImageCount, cssForBand, readerVarsForBand,
};
