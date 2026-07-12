'use strict';

/**
 * Industry-standard audience / format classification, aligned with how the
 * publishing world (BISAC audience tiers + the standard children's format
 * ladder) labels books. There is no universal *content* rating for books the way
 * movies have MPAA — the AUDIENCE/age tier is the accepted standard, so that's
 * what we surface.
 *
 * Kids books carry an age band (see ageBands.js); we map it to the matching
 * format category. Everything else is Adult (fiction vs nonfiction).
 */

// band key -> { category, ages, audience }. Ages mirror the app's own bands.
const BAND_CATEGORIES = {
  '1-2':   { category: 'Board Book',   ages: '1–2',   audience: 'Children', emoji: '🧸' },
  '3-5':   { category: 'Picture Book', ages: '3–5',   audience: 'Children', emoji: '🖍️' },
  '6-8':   { category: 'Early Reader', ages: '6–8',   audience: 'Children', emoji: '📗' },
  '9-12':  { category: 'Middle Grade', ages: '9–12',  audience: 'Children', emoji: '📘' },
  '13-16': { category: 'Young Adult',  ages: '13–16', audience: 'Young Adult', emoji: '📕' },
  '17-18': { category: 'Young Adult',  ages: '17–18', audience: 'Young Adult', emoji: '📕' },
};

// Order matters: an explicit FICTION signal wins first, so "science fiction",
// "historical fiction", or "financial thriller" never classify as nonfiction.
const FICTION_RE = /fiction|thriller|mystery|romance|fantasy|horror|novel|adventure|drama/i;
const NONFICTION_RE = /non-?fiction|self[\s-]?help|business|technolog|memoir|biograph|history|guide|reference|cookbook|science|finance|health/i;

/**
 * @param {object} book a book record (or { spec, ageBand, genre })
 * @returns {{category, ages, audience, label, short, emoji, kids}}
 */
function classifyBook(book) {
  const b = book || {};
  const spec = b.spec || {};
  const band = b.ageBand || spec.ageBand;
  if (band && BAND_CATEGORIES[band]) {
    const c = BAND_CATEGORIES[band];
    return { ...c, label: `${c.category} · Ages ${c.ages}`, short: c.category, kids: true };
  }
  // Adult: distinguish fiction vs nonfiction. The explicit spec.kind wins; else
  // a fiction keyword in the genre beats a nonfiction keyword ("science fiction").
  const genre = b.genre || spec.genre || '';
  const nonfiction = spec.kind === 'nonfiction'
    || (spec.kind !== 'fiction' && !FICTION_RE.test(genre) && NONFICTION_RE.test(genre));
  return nonfiction
    ? { category: 'Adult Nonfiction', ages: '18+', audience: 'Adult', emoji: '📙', label: 'Adult · Nonfiction', short: 'Adult', kids: false }
    : { category: 'Adult Fiction', ages: '18+', audience: 'Adult', emoji: '📖', label: 'Adult · Fiction', short: 'Adult', kids: false };
}

module.exports = { classifyBook, BAND_CATEGORIES };
