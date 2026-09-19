# Changelog

## [0.2.0] — Unreleased

### Added

- Refreshed text, image, and narration catalogs against September 2026 provider documentation, with current presets, a visible review date, model compatibility notes, and saved-pin retirement guidance. See [model support](docs/MODELS.md).
- Native CI for Intel Mac, Apple Silicon, Windows x64 and Windows ARM64. Source and packaged Electron smoke tests exercise generation, the UI, six exports, print dimensions and IPC isolation.
- A tagged release workflow that verifies all platforms, signs/notarizes Mac builds, supports Windows signing, and creates a draft with universal DMG/ZIP, x64/ARM64 EXE installers and SHA256 checksums.
- Outline approval, chapter rewrites and manual editing, story bible and reading statistics, sequel briefs, library search/list views and read-while-writing.
- DOCX, standalone HTML and 6×9 PDF interior export, alongside EPUB, reading PDF and Markdown. Print interiors still require publishing-platform review.
- Grok provider support, model presets, hybrid HTML/SVG illustrations, character reference photos and audiobook tools from the previous development cycle.
- Architecture, release acceptance and signing documentation, with explicit supported OS and cloud-data behavior.

### Fixed

- Made custom-model checks explicit so loading or typing a saved model never triggers a quota-consuming probe. Preserved unknown image/audio pins in Settings.
- Excluded Gemini thinking-draft images from final artwork and used compatible voice settings for expressive narration.
- Gave the reader a full-window layout, compact library cards, and responsive controls for smaller windows.
- Put writing briefs before optional engine controls and preserve adult/kids briefs and characters during navigation.
- Added native keyboard-accessible dialogs, accessible switches, export-menu keyboard handling, search feedback, and reduced-motion support.
- Added 12 real-Electron UI interaction groups and source/packaged screenshots to the native build checks.
- Corrected print PDF page dimensions to 6×9 inches and propagated export stream errors.
- Persisted chapters before optional illustration work, retained paused drafts when outline/cover steps fail, and blocked conflicting writes/deletes/clears.
- Invalidated cached narration when text or voice settings change; deduplicated simultaneous requests for the same audio.
- Fixed Windows npm-shim execution/PATH handling and quoted terminal login paths. Rejected nonzero CLI exits instead of accepting partial output.
- Added network deadlines/truncation handling, preserved split UTF-8 in Gemini streams and consumed the final streamed text line.
- Removed paid generation from Gemini/Nano Banana connection checks and stopped falsely validating unknown Gemini aliases.
- Corrected Gemini setup, cloud-privacy, artwork-cost and publishing claims in the interface and documentation.

### Security

- Upgraded Electron to 44.4.3 and electron-builder to 26.15.3, refreshed vulnerable dependencies and audited the full lockfile, including the shipped Electron runtime.
- Enabled renderer sandboxing; restricted IPC to the app's top frame; blocked unwanted navigation, permissions and arbitrary file opening.
- Sanitized rendered/exported Markdown and isolated PDF/art rendering from network and embedded local-file requests.
- Replaced regex-only SVG filtering with a static-element/attribute allowlist, including revalidation of older book artwork at export.
- Encrypted stored API/SMTP secrets with OS safeStorage, migrated existing settings/backup, protected recoverable backups and removed backup credentials during data clearing.
- Restricted provider CLI tools and protected settings merges against prototype pollution.

### Compatibility

- Requires macOS 13+ on Intel or Apple Silicon; Windows 10/11 x64 or Windows 11 ARM64. No 32-bit Windows package. Node.js 22.12+ is required only for source development and compatible CLI setup.
- Windows signatures depend on maintainer-provided credentials. Automated builds do not replace clean-machine install/upgrade tests or live provider acceptance checks.

## [0.1.0] — 2026-06-15

Initial release. Historical notes below describe that version; current platform, provider and privacy behavior is documented in README.md and SECURITY.md.

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
