# Changelog

All notable changes to ChapterOne are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the spirit of
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Outline review gate** — approve, retitle, rewrite, or cut chapters after
  planning and before any prose is written.
- **Author tools** — rewrite any chapter with a director's note, or hand-edit
  its Markdown; rename the book / set your author name; a **story bible**
  (premise, style guide, cast, chapter map) and **book stats** (words, pages,
  reading time, Flesch-Kincaid level).
- **Write the sequel** — one click prefills a sequel brief with the finished
  book's world, cast (incl. photos), and voice.
- **New export formats** — Word (.docx), single-file web page (.html), and a
  print-ready 6×9 PDF interior (KDP trim), alongside EPUB/PDF/Markdown, all in
  a new Export menu.
- **Finishing touches** — back-cover blurb + dedication written for every book;
  a book-is-born reveal (cover flip + confetti); idea sparks + Surprise-me on
  the Create screen; library search.

### Fixed (final audit pass)

- **Windows CLI execution** — npm `.cmd` shims can't be spawned by modern
  Node/Electron (CVE-2024-27980 hardening); CLIs now run via their real JS entry
  with the bundled runtime. Codex prompts moved to stdin (32K command-line cap);
  cancel now kills the full process tree; Mica is gated to Windows 11 22H2+ with
  a solid-background fallback; macOS-only titlebar padding removed off-Mac.
- **Data safety** — all book/settings writes are atomic (temp + rename) with a
  settings backup; a crash mid-write can no longer corrupt the library or lose
  API keys. Book ids are validated against path traversal.
- **Streams & processes** — a dropped Gemini connection mid-stream now errors
  (and retries) instead of hanging forever; a child that dies before reading
  stdin no longer crashes the app; UTF-8 characters split across pipe chunks no
  longer corrupt prose.
- **Typography** — heading levels (##–######) are preserved (they were flattened
  to #); en dashes survive in numeric ranges (1914–1918); URLs and link targets
  are no longer dash/quote-mangled.
- **Exports** — illustrated books no longer fail PDF export (2MB data-URL cap);
  HTML-art chapters are rasterized before export instead of silently losing
  their illustrations; EPUB write errors reject cleanly.
- **UI** — leaving the reader stops narration; the live-draft stream no longer
  rebuilds the whole progress screen every chunk; background auth checks no
  longer wipe half-filled forms; reader arrow keys ignore form controls;
  duplicate simultaneous generations are prevented; codex/grok output parsing
  no longer eats scene breaks, dates, or opening lines.
- **Art security** — rasterization runs in a network-dead session (all non-
  data:/file: requests cancelled) on top of a hardened sanitizer.

- **Grok engine** — xAI's Grok Build CLI as a fourth subscription engine
  (`grok -p`, OAuth on SuperGrok / X Premium Plus). Defaults to **Composer 2.5
  Fast** (benchmarked ~3–5× faster and more reliable than grok-build for prose);
  grok-build also selectable.
- **One-click model presets** — Fast / Pro / Default buttons set the right model
  on every engine in the chain at once (Claude, Codex, Gemini, Grok).
- **Custom model verification** — typing a custom model id verifies it live
  against the real provider (Grok/Gemini model lists; Claude/Codex probe) and
  shows ✓ valid / ✗ invalid / ⚠ can't-verify.
- **Hybrid HTML/CSS + inline-SVG chapter illustrations** — the engine designs a
  scene illustration per chapter, rendered to PNG via an offscreen Chromium
  window (free, on your subscription). Pure SVG remains a fallback.
- **Read while it writes** — a "Start reading" button opens the reader for an
  in-progress book; new chapters appear live and generation keeps running.
- **Library Tiles / List views** — uncropped full covers, a Finder-style list
  with a Created date, and an **audience classification** badge on every book
  (BISAC-aligned: Board Book / Picture Book / Early Reader / Middle Grade /
  Young Adult / Adult · Fiction/Nonfiction).
- **Kids character photos** — upload a photo per character; with Nano Banana they
  are passed as reference images so the cover and chapter art resemble them.
- Real app icon (the ChapterOne "1" brand mark) embedded in the macOS build,
  generated from `build/icon.svg` via `npm run icon`.

### Changed

- **Stock photos removed** — the small Creative-Commons pool was rarely relevant;
  AI vector art (free) and Nano Banana (paid) are the image options now.
- **Engine resilience** — the fallback chain now retries transient network /
  rate-limit / server errors with kind-aware backoff before giving up, so a
  cloud-CLI blip no longer ends a book; **Pause/Cancel** is responsive even
  mid-retry.
- **Codex** — replaced the removed `--search` flag with `-c tools.web_search=true`
  and defaulted reasoning to `medium` (xhigh burned the ChatGPT quota).
- **Grok** — web search is enabled only on the (bounded) author-study step and
  off elsewhere so chapters are fast; agentic "I'll verify… then write…"
  narration is stripped from output.

### Fixed

- IPC bridge dropped extra arguments, which made custom-model verification
  always pass green; it now forwards all arguments.
- A user cancel mid-request no longer resolves as a partial/short success — it
  rejects cleanly as "cancelled" and stops without retrying.

- **Docs** — README, CHANGELOG, and architecture docs updated for the four
  engines, hybrid illustrations, read-while-writing, model presets/verification,
  library views + audience classification, and Windows build readiness.

### Security

- Upgrade **nodemailer** 6 → 9 to fix a high-severity CRLF header-injection
  vulnerability ([GHSA-268h-hp4c-crq3](https://github.com/advisories/GHSA-268h-hp4c-crq3))
  in Send-to-Kindle / email delivery.
- Add **CodeQL** static analysis, a CI **dependency audit** (fails on
  high/critical vulns in shipped deps), and **Dependabot** updates.

## [0.1.0] — 2026-06-15

First public release.

### Added

- **Book generation** through your own Claude Code, Codex, or Gemini CLI
  subscription, with an automatic fallback chain across engines.
- **Fiction, non-fiction, and kids' books**, with age bands that drive
  vocabulary, length, reading level, safety, font size, and illustration
  density; custom characters in both adult and kids flows.
- **Research-grounded writing** via each CLI's own read-only web tools.
- **Multi-pass pipeline**: triage → outline → draft → editor polish →
  illustrate → continuity recap, resumable after every chapter.
- **AI illustrations**: engine-designed vector covers/art (sanitized SVG →
  PNG), **Nano Banana** photorealistic images (opt-in Gemini image key), or
  royalty-free Openverse stock photos with a credits page.
- **Audiobook narration (ElevenLabs)**: per-chapter and whole-book generation
  (cache-aware and resumable), a **Listen to the whole book** mode that
  remembers your place, top recommended voices, and **clone your own voice**.
- **Built-in reflowable EPUB reader** with themes, type controls, and remembered
  position; **EPUB / PDF export**; **Send to Kindle** (Mail hand-off or SMTP).
- **Flawless typography** pass (no stray markdown or em/en dashes).
- **Clear all my data** control with a type-to-confirm gate.
- **Subscription-not-API-key** enforcement; local-only storage; signed +
  notarized universal macOS build.

[0.1.0]: https://github.com/npandeya/bookwriter/releases/tag/v0.1.0
