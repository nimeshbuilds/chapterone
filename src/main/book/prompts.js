'use strict';

/**
 * Prompt library for the book generation pipeline.
 *
 * The guiding persona: a #1 bestselling author and seasoned developmental
 * editor in the reader's chosen genre. Every prompt asks for craft-level
 * quality, not generic filler.
 */

const { bandOf, unitsFor } = require('./ageBands');

/** Non-negotiable typography rules so the prose needs no cleanup tells. */
const STYLE_RULES =
  'TYPOGRAPHY (strict): Never use em dashes or en dashes (— or –), and never "--". Use commas, periods, semicolons, or parentheses instead. Do not use horizontal rules or rows of dashes/asterisks as scene breaks. Do not leave stray Markdown symbols (#, *, _, backticks) in the prose. Write clean, professionally punctuated sentences.';

/** Block listing user-supplied characters to feature (personalization). */
function charactersBlock(specOrBook) {
  const chars = ((specOrBook && specOrBook.characters) || []).filter((c) => c && c.name && c.name.trim());
  if (!chars.length) return '';
  const lines = chars.map((c) => `- ${c.name.trim()}${c.role && c.role.trim() ? ` — ${c.role.trim()}` : ''}`);
  return [
    `CHARACTERS TO FEATURE (use these EXACT names and personas; weave them in naturally and keep them consistent throughout — this makes the book personal to the reader):`,
    ...lines,
    `Make ${chars[0].name.trim()} the protagonist unless the brief clearly indicates otherwise.`,
  ].join('\n');
}

/** Children's-book directive derived from the chosen age band. */
function kidsDirective(specOrBook) {
  const band = bandOf(specOrBook);
  if (!band) return '';
  return [
    `CHILDREN'S BOOK — write for ${band.readingLevel}.`,
    `Reading level & voice: ${band.vocab}.`,
    `Length & format: about ${band.units} ${band.unit}${band.units === 1 ? '' : 's'} of roughly ${band.wordsPerUnit} words each; each ${band.unit} should stand as a clear beat.`,
    `Safety (strict): ${band.safety}. No profanity. Keep it wholesome and age-appropriate.`,
  ].join('\n');
}

// ---- Nano Banana image prompts ----

/** Consistent illustration style for a book's generated images. */
function artStyleFor(book) {
  if (bandOf(book)) {
    return `a warm, friendly, professional children's-book illustration style — soft rounded shapes, a bright cohesive palette, gentle lighting — kept consistent across the entire book`;
  }
  return `a polished editorial illustration that matches the book's mood and ${book.genre || 'genre'}, consistent in style across the book`;
}

function charactersVisualBlock(book) {
  const chars = ((book && book.characters) || []).filter((c) => c && c.name);
  if (!chars.length) return '';
  const base = `Depict these recurring characters consistently every time: ${chars.map((c) => `${c.name}${c.role ? ` (${c.role})` : ''}`).join('; ')}.`;
  // If the user uploaded reference photos, the generator passes them as input
  // images in the SAME order as these names — tell the model to use them.
  const withPhotos = chars.filter((c) => c.photo && c.photo.data).map((c) => c.name);
  if (!withPhotos.length) return base;
  return `${base} Reference photos are provided (in order) for: ${withPhotos.join(', ')}. Render each of these characters to clearly RESEMBLE their reference photo — same face, hair, skin tone and overall look — but redrawn in the book's illustration style (do not copy the photo realistically or include the background).`;
}

/** Reference photos for the characters that have one, in name order (matches
 *  charactersVisualBlock). Returned as Nano Banana inline-image inputs. */
function characterReferencePhotos(book) {
  return ((book && book.characters) || [])
    .filter((c) => c && c.name && c.photo && c.photo.data)
    .map((c) => ({ data: c.photo.data, mime: c.photo.mime || 'image/jpeg' }));
}

/** Image prompt for a book cover (Nano Banana). */
function coverImagePrompt(book) {
  return [
    `A beautiful book-cover illustration for "${book.title}"${book.subtitle ? ` — ${book.subtitle}` : ''}.`,
    `Genre/theme: ${book.genre || ''}. Mood: ${book.premise || ''}.`,
    `${artStyleFor(book)}.`,
    charactersVisualBlock(book),
    `Leave tasteful negative space near the top for a title. Do NOT render any text or letters. High quality, no watermark, no borders.`,
  ].filter(Boolean).join(' ');
}

/** Image prompt for a single scene/illustration within a chapter (Nano Banana). */
function sceneImagePrompt(book, chapter, sceneHint) {
  return [
    `An illustration for the book "${book.title}".`,
    `Scene to depict: ${sceneHint || chapter.summary || chapter.title}.`,
    `${artStyleFor(book)}.`,
    charactersVisualBlock(book),
    `A single cohesive illustration with NO text, letters, captions, or watermark.`,
  ].filter(Boolean).join(' ');
}

/**
 * Derive ONE royalty-free stock-photo search query for a chapter. Used in stock
 * mode as a reliable fallback when the writing model didn't embed an inline
 * `image-search:` marker itself (models are inconsistent about that). The reply
 * must be just the query words, or the single word NONE.
 */
function stockQueryPrompt(book, chapter, content) {
  const excerpt = String(content || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')   // drop any image markers
    .replace(/[#*`>_]/g, ' ')                 // drop markdown symbols
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  return [
    `Book: "${book.title}"${book.premise ? ` — ${book.premise}` : ''}.`,
    `Chapter: "${chapter.title}".`,
    `Excerpt: ${excerpt}`,
    ``,
    `Suggest ONE royalty-free stock-photo search query for the single most`,
    `visually evocative, concrete, photographable subject in this chapter — a`,
    `real place, landscape, object, building, tool, or scene that a photographer`,
    `could actually shoot. 3 to 7 plain words, no punctuation. Avoid abstract`,
    `ideas, named people, and anything not photographable. If nothing fits,`,
    `reply with the single word NONE.`,
  ].join('\n');
}

/** Normalize a spec/book's fiction-vs-nonfiction choice. '' = let the author decide. */
function kindOf(specOrBook) {
  const raw = String((specOrBook && (specOrBook.kind || specOrBook.category)) || '').toLowerCase();
  if (raw.startsWith('fic') || raw.includes('novel')) return 'fiction';
  if (raw.startsWith('non') || raw.includes('nonfiction') || raw.includes('non-fiction')) return 'nonfiction';
  return '';
}

/** A directive line for the outline brief describing the chosen category. */
function kindDirective(spec) {
  const k = kindOf(spec);
  if (k === 'fiction') return 'FICTION — write a narrative story with characters, scenes, and an emotional arc. Do NOT write it as an essay or how-to.';
  if (k === 'nonfiction') return 'NON-FICTION — write an authoritative, real-world book (ideas, explanation, instruction, or true account). Do NOT invent a fictional story.';
  return '(you choose fiction or non-fiction, whichever best serves the request)';
}

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
    `CATEGORY: ${kindOf(spec) || '(unspecified — fiction or non-fiction)'}`,
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
 * Step 1.5 — Study the category's very best authors so we can learn from and
 * then surpass them. Returns JSON { category, authors[], blueprint }.
 */
function mastersPrompt(spec) {
  return [
    `You are a literary scholar and a bestselling ghostwriter. For the brief below, identify the FIVE most acclaimed, bestselling, and influential authors whose work best matches its category, genre, and ambition.`,
    ``,
    `BRIEF`,
    `- Request: ${spec.request || '(none)'}`,
    bandOf(spec) ? `- ${kidsDirective(spec)}` : `- Category: ${kindDirective(spec)}`,
    `- Genre: ${spec.genre || '(infer the best-fitting genre)'}`,
    `- Audience: ${spec.audience || (bandOf(spec) ? bandOf(spec).label : '(infer)')}`,
    bandOf(spec) ? `Pick the most acclaimed CHILDREN'S authors for this exact age group.` : '',
    spec.research
      ? `You may use web search to ground your picks in real, current bestseller lists and awards. Use ONLY real authors and real, verifiable craft observations.`
      : `Use only real, well-known authors and accurate craft observations.`,
    ``,
    `For each author, distil precisely what makes their writing great and beloved: voice, structure, pacing, characterization or argumentation, sentence craft, signature techniques, and emotional effect on readers.`,
    `Then write a BLUEPRINT: a concrete plan to combine the strongest techniques of all five — and push beyond them — to produce a book that SURPASSES each of them for this specific brief.`,
    ``,
    `Respond with ONLY a JSON object in this exact shape:`,
    `{`,
    `  "category": "string",`,
    `  "authors": [ { "name": "Real Author", "known_for": "1-3 representative works", "signature": "what makes them exceptional and how to apply it to this book" } ],`,
    `  "blueprint": "4-8 sentences: the synthesis strategy to exceed all five for THIS book"`,
    `}`,
  ].filter(Boolean).join('\n');
}

/** A reusable directive that injects the studied masters + the surpass mandate. */
function influenceDirective(influences) {
  if (!influences || !influences.blueprint) return '';
  const names = (influences.authors || []).map((a) => a && a.name).filter(Boolean).join(', ');
  return [
    `MASTERY BENCHMARK — you have studied the very best in this category${names ? `: ${names}` : ''}:`,
    ...(influences.authors || []).slice(0, 5).map((a) => `- ${a.name}: ${a.signature || a.known_for || ''}`),
    `WINNING BLUEPRINT (follow it): ${influences.blueprint}`,
    `YOUR MANDATE: write a book that is demonstrably BETTER than any of these authors could produce for this brief — equal craft, greater originality, sharper execution, deeper emotional payoff. Synthesize their strengths; never imitate, pastiche, or plagiarize any single one.`,
  ].join('\n');
}

/**
 * Step 2 — Produce the book concept and full chapter outline. Returns JSON.
 */
function outlinePrompt(spec, answers, influences) {
  const answerBlock = formatAnswers(answers);
  const band = bandOf(spec);
  const kidUnits = band ? unitsFor(spec, spec.kidsLength) : 0;
  const chapterHint = band
    ? `about ${kidUnits} ${band.unit}${kidUnits === 1 ? '' : 's'} (~${band.wordsPerUnit} words each) — call them chapters in the JSON`
    : chapterHintForSize(spec);
  const influenceBlock = influenceDirective(influences);
  const kidsBlock = kidsDirective(spec);
  const charsBlock = charactersBlock(spec);
  return [
    bestsellerPersona(spec.genre),
    influenceBlock ? '\n' + influenceBlock : '',
    kidsBlock ? '\n' + kidsBlock : '',
    charsBlock ? '\n' + charsBlock : '',
    ``,
    `Design a complete, market-ready book based on the brief below. Think like an author pitching to a major publisher: a killer title, a compelling premise, and a chapter structure with strong narrative/argumentative momentum.`,
    ``,
    `BRIEF`,
    `- Request: ${spec.request || '(none)'}`,
    band ? `- Category: a children's book — ${band.label}` : `- Category: ${kindDirective(spec)}`,
    `- Genre: ${spec.genre || '(you choose the best fit)'}`,
    `- Audience: ${spec.audience || (band ? band.label : '(you choose)')}`,
    spec.authorName && spec.authorName.trim()
      ? `- Author: use exactly "${spec.authorName.trim()}" as the author name; do NOT invent a pen name.`
      : `- Author: invent a fitting, realistic pen name.`,
    `- Target book size: ${chapterHint}. Plan the number and scope of chapters so the finished book lands in that range based on what the topic genuinely needs — do not pad.`,
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
    `  "kind": "fiction | nonfiction",`,
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
    influenceDirective(book.influences),
    kidsDirective(book),
    charactersBlock(book),
    ``,
    `You are writing ONE chapter of the book "${book.title}"${book.subtitle ? ` — ${book.subtitle}` : ''}.`,
    ``,
    `BOOK STYLE GUIDE (obey strictly for consistency): ${book.styleGuide || 'Confident, vivid, immersive prose appropriate to the genre.'}`,
    kindOf(book) ? `CATEGORY: ${kindOf(book) === 'fiction' ? 'FICTION — narrative storytelling with scene, character, and dialogue.' : 'NON-FICTION — real, accurate, instructive/explanatory writing; no invented story.'}` : '',
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
    `- For non-fiction: use concrete examples, stories, and actionable insight; never generic platitudes.`,
    `- End on a line that pulls the reader into the next chapter.`,
    `- FLOW (critical): open by connecting seamlessly to where the previous chapter left off — no abrupt restarts or recaps. Maintain one consistent voice, tense, and rhythm; make every paragraph follow naturally from the last with smooth transitions. The finished book must read as a single, masterful, cover-to-cover work by one brilliant author, not a series of disconnected sections.`,
    `- ${STYLE_RULES}`,
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
    `ILLUSTRATIONS: This book is illustrated with royalty-free photography. Include ONE well-chosen image in this chapter (occasionally a second only if the chapter clearly benefits), each on its own line, in EXACTLY this format:`,
    `![A polished, specific caption](image-search: 3-7 concrete visual search terms)`,
    `- Use CONCRETE, PHOTOGRAPHABLE subjects: real places, landscapes, cityscapes, architecture, nature, animals, objects, food, textures, period detail. Avoid abstract ideas, charts, diagrams, or anything that yields generic clip-art.`,
    `- Pick the most visually evocative moment or setting in the chapter, and make the search terms precise and visual so the result is tightly relevant to the surrounding text.`,
    `- Write captions that read like a professionally published book's captions.`,
    `- Do NOT request copyrighted characters, brand logos, memes, or identifiable private individuals.`,
    `- A high-resolution stock photo should plausibly exist for the subject. Only if a chapter is wholly abstract with no photographable subject at all is it acceptable to skip the image there.`,
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
    influenceDirective(book.influences),
    ``,
    `STYLE GUIDE (must hold): ${book.styleGuide || 'vivid, immersive, consistent voice'}`,
    `PREMISE: ${book.premise}`,
    ``,
    `Editing priorities:`,
    `- Sharpen the opening hook and the closing line.`,
    `- Improve pacing and flow; cut filler, clichés, repetition, and throat-clearing.`,
    `- Deepen sensory detail, subtext, and character/idea specificity. Strengthen weak verbs.`,
    `- Fix continuity, tense, POV and factual consistency. Keep all names/facts intact.`,
    `- ${STYLE_RULES}`,
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
/**
 * Hybrid HTML/CSS + inline-SVG SCENE illustration for a chapter. This is the
 * preferred art path: models compose far richer, more relevant pictures in
 * HTML/CSS than in raw SVG, and we render the result to PNG through an offscreen
 * Chromium window. The goal is a real depiction of the chapter's scene, not a
 * decorative title banner.
 */
function chapterArtHtmlPrompt(book, chapter, { width = 1200, height = 750 } = {}) {
  const chars = charactersVisualBlock(book);
  return [
    `You are a world-class illustrator and front-end designer. Create ONE beautiful, fully-rendered ILLUSTRATION that DEPICTS THE KEY SCENE of this chapter — an actual picture of what happens (its setting, characters, and objects), NOT a title card, NOT an abstract banner.`,
    ``,
    `BOOK: ${book.title}${book.premise ? ` — ${book.premise}` : ''}`,
    `GENRE: ${book.genre || ''}`,
    `ART STYLE: ${artStyleFor(book)}`,
    `CHAPTER ${chapter.number}: ${chapter.title}`,
    `SCENE TO DEPICT: ${chapter.summary || (chapter.beats || []).join('; ') || chapter.title}`,
    chars ? `CHARACTERS (draw them consistently): ${chars}` : '',
    ``,
    `Deliver a single self-contained HTML fragment that renders to exactly ${width}x${height} px:`,
    `- A root element exactly ${width}px wide by ${height}px tall, containing an inline <style>.`,
    `- COMPOSE A REAL SCENE: a clear focal subject, a setting/background, a sense of depth (foreground, midground, background), and lighting/mood that fit the chapter.`,
    `- Use CSS for environment, gradients, lighting, shadows, atmosphere, and layout; use INLINE SVG for precise shapes (characters, creatures, objects, silhouettes). Combine both freely and layer them.`,
    `- Cohesive, tasteful, premium palette that matches the book's mood. Soft shadows, gradients, and glow where apt. Make it look professionally designed and emotionally resonant.`,
    `- NO title text, NO captions, NO labels, NO watermark — it is an illustration, not a poster. Do not write the chapter title anywhere.`,
    `- SELF-CONTAINED ONLY: inline CSS and inline SVG (emoji allowed). Absolutely NO <script>, NO <iframe>, NO external images, fonts, links, or URLs, NO network requests, NO animation that depends on JavaScript.`,
    ``,
    `Output ONLY the HTML fragment, starting with a tag (e.g. <div ...>). No markdown code fences, no commentary.`,
  ].filter(Boolean).join('\n');
}

/**
 * Hybrid HTML/CSS + inline-SVG front cover. Unlike chapter art, the cover SHOULD
 * carry the title and author with strong typography.
 */
function coverArtHtmlPrompt(book, { width = 1200, height = 1800 } = {}) {
  return [
    `You are a celebrated book-cover designer. Design a striking, professional, sales-ready FRONT COVER as a single self-contained HTML fragment that renders to exactly ${width}x${height} px.`,
    ``,
    `TITLE: ${book.title}`,
    book.subtitle ? `SUBTITLE: ${book.subtitle}` : '',
    `AUTHOR: ${book.author || ''}`,
    `GENRE: ${book.genre || ''}`,
    `ART STYLE: ${artStyleFor(book)}`,
    `MOOD/PREMISE: ${book.premise || ''}`,
    `THEMES: ${(book.themes || []).join(', ')}`,
    ``,
    `Rules:`,
    `- Root element exactly ${width}px wide by ${height}px tall, with an inline <style>.`,
    `- A bold, evocative illustration/background — CSS gradients, lighting, depth, and inline SVG art/iconography/symbolism that capture the genre and emotional tone. Think comparable bestsellers.`,
    `- Strong typographic hierarchy: the TITLE prominent and the AUTHOR name clear, well-kerned and legible. Use only generic system font stacks (e.g. Georgia, serif / Helvetica, sans-serif).`,
    `- Premium, cohesive palette with atmosphere and depth.`,
    `- SELF-CONTAINED ONLY: inline CSS and inline SVG (emoji allowed). NO <script>, NO external images, fonts, links, or URLs, NO network.`,
    ``,
    `Output ONLY the HTML fragment, starting with a tag (e.g. <div ...>). No markdown code fences, no commentary.`,
  ].filter(Boolean).join('\n');
}

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
  kindOf,
  kindDirective,
  kidsDirective,
  charactersBlock,
  characterReferencePhotos,
  coverImagePrompt,
  sceneImagePrompt,
  stockQueryPrompt,
  artStyleFor,
  mastersPrompt,
  influenceDirective,
  clarifyPrompt,
  outlinePrompt,
  chapterPrompt,
  editPrompt,
  recapPrompt,
  researchInstruction,
  imageInstruction,
  coverSvgPrompt,
  chapterArtSvgPrompt,
  chapterArtHtmlPrompt,
  coverArtHtmlPrompt,
  SIZES,
  sizeOf,
  chapterHintForSize,
  targetWordsForLength,
  lengthToChapterHint,
};
