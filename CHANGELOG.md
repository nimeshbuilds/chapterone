# Changelog

All notable changes to ChapterOne are documented here. This project adheres to
[Semantic Versioning](https://semver.org/) and the spirit of
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Real app icon (the ChapterOne "1" brand mark) embedded in the macOS build,
  generated from `build/icon.svg` via `npm run icon`.

### Changed

- Open-source documentation pass: README, SIGNING, and community docs updated;
  CLI install/sign-in commands corrected to the exact packages
  (`@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`).

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
