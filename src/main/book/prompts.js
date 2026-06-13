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
  const chapterHint = lengthToChapterHint(spec.length);
  return [
    bestsellerPersona(spec.genre),
    ``,
    `Design a complete, market-ready book based on the brief below. Think like an author pitching to a major publisher: a killer title, a compelling premise, and a chapter structure with strong narrative/argumentative momentum.`,
    ``,
    `BRIEF`,
    `- Request: ${spec.request || '(none)'}`,
    `- Genre: ${spec.genre || '(you choose the best fit)'}`,
    `- Audience: ${spec.audience || '(you choose)'}`,
    `- Desired length: ${spec.length || 'standard'} (${chapterHint})`,
    `- Tone/style: ${spec.tone || '(you choose what sells best)'}`,
    `- Point of view: ${spec.pov || '(you choose)'}`,
    `- Notes: ${spec.notes || '(none)'}`,
    answerBlock,
    ``,
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
 */
function chapterPrompt(book, chapter, prevSummary, targetWords) {
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
    ``,
    `Output format: Markdown. Start with "# ${chapter.title}" as the chapter heading, then the prose. Do NOT include the word "Chapter N" unless it reads naturally. Do NOT add author commentary, disclaimers, or word counts.`,
  ].join('\n');
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

function lengthToChapterHint(length) {
  const l = (length || '').toLowerCase();
  if (l.includes('short') || l.includes('novella') || l.includes('quick')) {
    return 'about 6-10 chapters';
  }
  if (l.includes('epic') || l.includes('long') || l.includes('800')) {
    return 'about 24-40 chapters';
  }
  return 'about 12-20 chapters';
}

/** Map a length preference to a per-chapter word target. */
function targetWordsForLength(length) {
  const l = (length || '').toLowerCase();
  if (l.includes('short') || l.includes('novella')) return 1600;
  if (l.includes('epic') || l.includes('long')) return 3200;
  return 2400;
}

module.exports = {
  bestsellerPersona,
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  recapPrompt,
  targetWordsForLength,
  lengthToChapterHint,
};
