'use strict';

/**
 * Prompt library for the book generation pipeline.
 *
 * The guiding persona: a #1 bestselling author and seasoned developmental
 * editor in the reader's chosen genre. Every prompt asks for craft-level
 * quality, not generic filler.
 */

function bestsellerPersona(genre) {
  const g = genre && genre.trim() ? genre.trim() : 'the requested genre';
  return [
    `You are a #1 internationally bestselling author and award-winning developmental editor specializing in ${g}.`,
    `Your books top the charts because they combine an irresistible hook, deeply human characters or ideas, immaculate pacing, vivid sensory prose, and emotional payoff.`,
    `You understand market expectations, genre conventions, comparable titles, and what makes readers unable to put a book down — and you deliver on all of them.`,
    `You write with a distinctive, confident voice. You never produce bland, repetitive, or padded text. Every paragraph earns its place.`,
  ].join(' ');
}

/**
 * Step 1 — Triage the request. Decide if we have enough to write a great book,
 * or if we must ask the reader a few sharp clarifying questions.
 * Returns JSON.
 */
function clarifyPrompt(spec) {
  return [
    `A reader has asked for a book. Here is their request and any preferences they provided.`,
    ``,
    `REQUEST: ${spec.request || '(none given)'}`,
    `GENRE: ${spec.genre || '(unspecified)'}`,
    `TARGET AUDIENCE: ${spec.audience || '(unspecified)'}`,
    `APPROX LENGTH: ${spec.length || '(unspecified)'}`,
    `TONE / STYLE: ${spec.tone || '(unspecified)'}`,
    `OTHER NOTES: ${spec.notes || '(none)'}`,
    ``,
    `As the bestselling author who will write this, decide whether the request is clear enough to produce a truly excellent, on-target book.`,
    `If anything important is ambiguous (genre, audience, core premise, tone, length, key constraints), ask between 2 and 5 crisp clarifying questions. Prefer multiple-choice or short-answer questions that are easy to answer.`,
    `If the request is already rich enough, do NOT invent unnecessary questions — proceed.`,
    ``,
    `Respond with ONLY a JSON object, no prose, in this exact shape:`,
    `{`,
    `  "needsClarification": boolean,`,
    `  "questions": [ { "id": "short_key", "question": "text", "why": "why it matters", "suggestions": ["option a","option b"] } ],`,
    `  "assumptions": ["assumptions you'd make if the reader doesn't answer"],`,
    `  "summary": "one-sentence read on what they seem to want"`,
    `}`,
  ].join('\n');
}

/**
 * Step 2 — Produce the book concept and full chapter outline. Returns JSON.
 */
function outlinePrompt(spec, answers) {
  const answerBlock = formatAnswers(answers);
  const chapterHint = chapterHintForSize(spec);
  return [
    bestsellerPersona(spec.genre),
    ``,
    `Design a complete, market-ready book based on the brief below. Think like an author pitching to a major publisher: a killer title, a compelling premise, and a chapter structure with strong narrative/argumentative momentum.`,
    ``,
    `BRIEF`,
    `- Request: ${spec.request || '(none)'}`,
    `- Genre: ${spec.genre || '(you choose the best fit)'}`,
    `- Audience: ${spec.audience || '(you choose)'}`,
    `- Target book size: ${chapterHint}. Plan the number and scope of chapters so the finished book lands in that page range based on what the topic genuinely needs — do not pad.`,
    `- Tone/style: ${spec.tone || '(you choose what sells best)'}`,
    `- Point of view: ${spec.pov || '(you choose)'}`,
    `- Notes: ${spec.notes || '(none)'}`,
    answerBlock,
    ``,
    spec.research ? `RESEARCH: You have web search available. Verify real names, facts, places, dates and current details so the concept and outline are authentic and accurate. Never fabricate sources.` : '',
    `Requirements:`,
    `- The outline must be cohesive: every chapter advances the story or argument and avoids repetition.`,
    `- For fiction: include an arc with setup, escalating complications, midpoint shift, crisis, climax, and resolution. Give each chapter a goal, conflict, and turn.`,
    `- For non-fiction: a logical through-line where each chapter builds on the last, with a clear promise and payoff.`,
    `- Write chapter summaries that are concrete (real beats, names, ideas) — not vague placeholders.`,
    ``,
    `Respond with ONLY a JSON object in this exact shape:`,
    `{`,
    `  "title": "string",`,
    `  "subtitle": "string or empty",`,
    `  "author": "a fitting pen name",`,
    `  "genre": "string",`,
    `  "audience": "string",`,
    `  "logline": "one irresistible sentence",`,
    `  "premise": "2-4 sentence premise / back-cover hook",`,
    `  "themes": ["theme", "theme"],`,
    `  "styleGuide": "2-3 sentences describing voice, tense, POV, and prose style to keep every chapter consistent",`,
    `  "chapters": [`,
    `    { "number": 1, "title": "string", "summary": "concrete 3-5 sentence synopsis", "beats": ["beat","beat","beat"] }`,
    `  ]`,
    `}`,
  ].join('\n');
}

/**
 * Step 3 — Write one full chapter. Returns Markdown prose (not JSON).
 * @param {object} [flags] { research:boolean, illustrate:boolean }
 */
function chapterPrompt(book, chapter, prevSummary, targetWords, flags = {}) {
  return [
    bestsellerPersona(book.genre),
    ``,
    `You are writing ONE chapter of the book "${book.title}"${book.subtitle ? ` — ${book.subtitle}` : ''}.`,
    ``,
    `BOOK STYLE GUIDE (obey strictly for consistency): ${book.styleGuide || 'Confident, vivid, immersive prose appropriate to the genre.'}`,
    `GENRE: ${book.genre} | AUDIENCE: ${book.audience}`,
    `PREMISE: ${book.premise}`,
    `THEMES: ${(book.themes || []).join(', ')}`,
    ``,
    prevSummary
      ? `WHAT HAPPENED JUST BEFORE (continue seamlessly, do not contradict): ${prevSummary}`
      : `This is the opening — earn the reader's attention from the first line.`,
    flags.research ? '\n' + researchInstruction() : '',
    ``,
    `WRITE CHAPTER ${chapter.number}: "${chapter.title}"`,
    `Cover these beats, in a natural flow: ${(chapter.beats || []).join('; ') || chapter.summary}`,
    `Intended content: ${chapter.summary}`,
    ``,
    `Craft rules:`,
    `- Target roughly ${targetWords} words. Write the FULL chapter prose — no summaries, outlines, or notes.`,
    `- Show, don't tell. Use scene, sensory detail, subtext, and strong verbs. Vary sentence rhythm.`,
    `- Stay in the established voice, tense, and POV. Keep names and facts consistent with the premise.`,
    `- For non-fiction: use concrete examples, stories, and actionable insight — never generic platitudes.`,
    `- End on a line that pulls the reader into the next chapter.`,
    flags.illustrate ? imageInstruction() : '',
    ``,
    `Output format: Markdown. Start with "# ${chapter.title}" as the chapter heading, then the prose. Do NOT include the word "Chapter N" unless it reads naturally. Do NOT add author commentary, disclaimers, or word counts.`,
  ].filter(Boolean).join('\n');
}

/** Instruction block enabling web-grounded accuracy. */
function researchInstruction() {
  return [
    `RESEARCH: You have web search available. Before and while writing, look up the real facts, places, names, terminology, history, data, and current details relevant to this chapter.`,
    `- Ground everything in accurate, verifiable information. NEVER invent statistics, quotes, studies, or citations.`,
    `- For non-fiction, weave in credible, specific facts and attribute them naturally in prose (e.g. "according to ...").`,
    `- For fiction, use research so settings, professions, technology and cultural detail feel authentic.`,
  ].join('\n');
}

/** Instruction block letting the model request royalty-free illustrations. */
function imageInstruction() {
  return [
    `ILLUSTRATIONS (premium quality only): Where a single, striking image would genuinely elevate the reader's experience, you may insert at most ONE or TWO image markers, each on its own line, in EXACTLY this format:`,
    `![A polished, specific caption](image-search: 3-7 concrete visual search terms)`,
    `- Quality bar: this is a book people PAY for. Only suggest an image when a beautiful, professional, high-resolution stock photo almost certainly exists for it.`,
    `- Use CONCRETE, PHOTOGRAPHABLE subjects: real places, landscapes, architecture, nature, objects, food, textures, period detail. Avoid abstract ideas, charts, or anything that yields generic clip-art.`,
    `- Make the search terms precise and visual so the result is tightly relevant to the surrounding text.`,
    `- Write captions that read like a professionally published book's captions.`,
    `- Do NOT request copyrighted characters, brand logos, memes, or identifiable private individuals.`,
    `- Be sparing — a few perfect images beat many mediocre ones. Many chapters need none.`,
  ].join('\n');
}

/**
 * Step 3b (agentic editor pass) — a senior developmental editor critiques and
 * rewrites the freshly drafted chapter to bestseller quality. Returns Markdown.
 */
function editPrompt(book, chapter, draft, flags = {}) {
  return [
    `You are a ruthless, world-class developmental editor and line editor for #1 bestsellers in ${book.genre || 'this genre'}.`,
    `Revise the chapter below into its strongest possible final form. This book is sold to paying readers — every line must earn its place.`,
    ``,
    `STYLE GUIDE (must hold): ${book.styleGuide || 'vivid, immersive, consistent voice'}`,
    `PREMISE: ${book.premise}`,
    ``,
    `Editing priorities:`,
    `- Sharpen the opening hook and the closing line.`,
    `- Improve pacing and flow; cut filler, clichés, repetition, and throat-clearing.`,
    `- Deepen sensory detail, subtext, and character/idea specificity. Strengthen weak verbs.`,
    `- Fix continuity, tense, POV and factual consistency. Keep all names/facts intact.`,
    `- Preserve the chapter's events, length, and any "![caption](image-search: …)" or "![caption](bwimg:…)" image lines exactly.`,
    flags.research ? `- You may use web search to verify any real-world facts before finalizing; never invent sources.` : '',
    ``,
    `Return ONLY the revised chapter in Markdown, starting with "# ${chapter.title}". No notes, no commentary, no explanation of changes.`,
    ``,
    `--- DRAFT TO REVISE ---`,
    draft,
  ].filter(Boolean).join('\n');
}

/**
 * Cover art — ask the model (acting as a senior book-cover designer) to
 * produce a single, self-contained SVG cover that matches the book's soul.
 * Text models can't draw raster images, but they design excellent vector art.
 */
function coverSvgPrompt(book, { width = 1200, height = 1800 } = {}) {
  return [
    `You are a celebrated book-cover designer. Design a striking, professional, sales-ready front cover for the book below, as a single self-contained SVG.`,
    ``,
    `TITLE: ${book.title}`,
    book.subtitle ? `SUBTITLE: ${book.subtitle}` : '',
    `AUTHOR: ${book.author || ''}`,
    `GENRE: ${book.genre || ''}`,
    `THEMES: ${(book.themes || []).join(', ')}`,
    `MOOD/PREMISE: ${book.premise || ''}`,
    ``,
    `Design rules:`,
    `- Capture the genre and emotional tone through composition, an evocative color palette, gradients, geometry, and tasteful iconography/symbolism. Think comparable bestsellers.`,
    `- Include the TITLE prominently and the AUTHOR name, with strong typographic hierarchy. Keep text legible and well-kerned.`,
    `- Use only vector shapes, paths, gradients, and <text>. NO external images, fonts, or links. Use generic font-family stacks (e.g. Georgia, serif / Helvetica, sans-serif).`,
    `- It must be a complete, valid SVG with viewBox="0 0 ${width} ${height}". No raster <image>, no <script>, no <foreignObject>, no event handlers.`,
    ``,
    `Output ONLY the SVG markup, starting with <svg and ending with </svg>. No code fences, no commentary.`,
  ].filter(Boolean).join('\n');
}

/**
 * Chapter illustration — one tasteful, theme-matched SVG vignette per chapter.
 */
function chapterArtSvgPrompt(book, chapter, { width = 1200, height = 700 } = {}) {
  return [
    `You are an editorial illustrator for a premium ${book.genre || ''} book. Create ONE elegant, atmospheric chapter illustration as a single self-contained SVG that visually echoes this chapter and the book's overall design.`,
    ``,
    `BOOK: ${book.title} — ${book.premise || ''}`,
    `BOOK THEMES: ${(book.themes || []).join(', ')}`,
    `CHAPTER ${chapter.number}: ${chapter.title}`,
    `CHAPTER GIST: ${chapter.summary || (chapter.beats || []).join('; ')}`,
    ``,
    `Rules:`,
    `- Wide banner composition, viewBox="0 0 ${width} ${height}". Cohesive palette that fits the book's mood; can be minimalist or richly layered.`,
    `- Vector only: shapes, paths, gradients. Little or no text (a small motif is fine). NO external images/fonts/links, NO <script>, NO <foreignObject>, NO event handlers.`,
    `- Must read clearly at small sizes and feel like part of a designed book.`,
    ``,
    `Output ONLY the SVG markup, starting with <svg and ending with </svg>. No code fences, no commentary.`,
  ].filter(Boolean).join('\n');
}

/**
 * Step 4 — Compress a freshly written chapter into a short continuity note,
 * so the next chapter stays coherent without resending full text.
 */
function recapPrompt(chapterTitle, chapterText) {
  return [
    `Summarize the following chapter in 3-4 sentences capturing plot/argument progress, character/idea state, and any unresolved threads. This will be used to keep the next chapter consistent. Output plain text only.`,
    ``,
    `CHAPTER: ${chapterTitle}`,
    ``,
    chapterText.slice(0, 12000),
  ].join('\n');
}

// ---- helpers ----

function formatAnswers(answers) {
  if (!answers || !Object.keys(answers).length) return '';
  const lines = ['', 'READER CLARIFICATIONS:'];
  for (const [k, v] of Object.entries(answers)) {
    if (v == null || v === '') continue;
    lines.push(`- ${k}: ${v}`);
  }
  return lines.length > 2 ? lines.join('\n') : '';
}

// ---- book size ----

/**
 * Book sizes the reader can pick, with page ranges and the chapter/word plan we
 * use to hit them (~275 words per typeset page).
 */
const SIZES = {
  small: { key: 'small', label: 'Small', pages: '35–60 pages', minCh: 8, maxCh: 12, words: 1500 },
  medium: { key: 'medium', label: 'Medium', pages: '75–125 pages', minCh: 12, maxCh: 16, words: 2000 },
  large: { key: 'large', label: 'Large', pages: '150–250 pages', minCh: 20, maxCh: 28, words: 2500 },
};

/** Resolve a spec to a size definition (new `size` field, or legacy `length`). */
function sizeOf(spec) {
  const raw = String((spec && (spec.size || spec.length)) || '').toLowerCase();
  if (raw.includes('small') || raw.includes('short') || raw.includes('novella')) return SIZES.small;
  if (raw.includes('large') || raw.includes('epic') || raw.includes('long')) return SIZES.large;
  return SIZES.medium;
}

function chapterHintForSize(spec) {
  const s = sizeOf(spec);
  return `${s.pages}, about ${s.minCh}-${s.maxCh} chapters`;
}

/** Per-chapter word target for a spec's size. */
function targetWordsForLength(spec) {
  // Accepts a spec object or a legacy length string.
  return sizeOf(typeof spec === 'string' ? { length: spec } : spec).words;
}
// Back-compat alias used by older callers/tests.
function lengthToChapterHint(length) {
  return chapterHintForSize({ length });
}

module.exports = {
  bestsellerPersona,
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  editPrompt,
  recapPrompt,
  researchInstruction,
  imageInstruction,
  coverSvgPrompt,
  chapterArtSvgPrompt,
  SIZES,
  sizeOf,
  chapterHintForSize,
  targetWordsForLength,
  lengthToChapterHint,
};
