# UI review and interaction checks

The 0.2.0 release-readiness branch includes a focused UI review, not a claim of exhaustive testing. Run `npm run test:smoke` to exercise the real Electron main process, preload, sandboxed renderer, persistence, and export code with an isolated temporary library and a scripted provider. No real provider account, microphone, email recipient, or API credit is used.

## Changes from the review

- The reader uses the whole window. Its title, typography controls, and actions wrap without being squeezed beside the sidebar or setup banner. The closed contents drawer cannot receive keyboard focus; chapter editing is disabled on the title/cover pages.
- Library covers are compact, with readable titles/authors outside the cover, explicit status, keyboard-operable book links, searchable tile/list views, counts, and a clear empty-search state.
- Adult and kids screens start with the brief. Engine/model controls live under “Writing options.” Briefs and characters survive navigation within the session. Background connection checks preserve unsaved settings.
- Native modal dialogs provide inert background content, keyboard focus handling, Escape dismissal, and focus restoration. Promise-based confirmations resolve on cancellation. Export options support keyboard navigation and clean up their outside-click handler when the reader closes.
- Research/polish switches are keyboard accessible. Form labels, navigation state, visible focus, muted text, responsive layout, and reduced-motion behavior were improved. Deleting a book reports errors; clearing all data also clears in-memory briefs.

## Automated UI coverage

`scripts/ui-checks.cjs` runs these 12 interaction groups inside the smoke test:

- Model presets, current choices, preserved custom/media pins, retirement notices, explicit checks only, no probes on typing/navigation, and model controls at compact size.

1. Search by author, case-insensitive matching, no matches, clearing search, and tile/list persistence.
2. Adult/kids brief, character, and age selection preservation; writing controls when no engine is configured.
3. Library, list, adult/kids forms, and settings at a 900×640 content window with 125% zoom; main-content horizontal overflow checks.
4. Provider setup dialog naming, Tab traversal, Escape, focus restoration, keyboard switches, saved toggle settings, and retaining unsaved commands during connection checks.
5. Keyboard book opening, contents drawer, chapter navigation, reading position, typeface, theme, scroll/page mode, and compact reader controls.
6. Export-menu keyboard traversal and Escape without leaving the reader.
7. Book statistics, story bible, blank-title rejection, rename, chapter edits, persisted prose, and updated HTML export.
8. Book deletion cancellation with both Escape and Cancel, followed by another usable confirmation.
9. Writing through clarification, suggested answers, editing the chapter map, removing a chapter, approval, generation, completion, reading, and confirmed deletion.
10. Light/dark screenshots and reduced-motion emulation.
11. Incorrect/correct clear-data confirmation, empty library, and a fresh writing brief afterward.

The surrounding smoke suite also checks six export formats, actual 6×9 PDF dimensions, SVG rasterization, sandbox configuration, and rejected untrusted IPC/file opening. Node unit tests cover lower-level provider/network, security, persistence, cancellation/resume, art/audio, and export behavior.

CI runs the suite on Mac Intel, Mac Apple Silicon, Windows x64, and Windows ARM64, both from source and against the packaged `app.asar`. Reports and screenshots are uploaded in each job's `smoke-*` artifact. See the [latest branch runs](https://github.com/nimeshbuilds/chapterone/actions/workflows/ci.yml?query=branch%3Arelease-readiness). Check that every job passed for the exact commit being released.

Local artifacts are under `artifacts/ui-<platform>-<arch>-source/` or `-packaged/`, with a `report.json` containing completed groups and actual screenshot viewport sizes. The desktop can limit the requested larger window size; the report records the resulting viewport. A failed assertion makes the parent smoke command fail and saves a failure screenshot.

## Still needs hands-on acceptance

- Real CLI installation/login, live text generation, provider fallback/quota recovery, image billing consent, narration/voice cloning, microphones/speakers, Mail/SMTP and Kindle delivery.
- Clean-machine install, launch, upgrade, uninstall, file associations/OS permissions, Gatekeeper/notarization and Windows publisher prompts on the supported OS versions.
- VoiceOver and NVDA, a full contrast/accessibility audit, 200% zoom/reflow, high-contrast mode, long manuscripts/large libraries, unusual display scaling, and sustained generation/reading.
- Physical Intel/Apple Silicon Macs and Windows x64/ARM64 devices; hosted CI does not represent every GPU, display, or OS configuration.

Use the [release acceptance checklist](RELEASING.md#manual-acceptance-before-public-launch) before publishing. Live services and installer acceptance remain separate release gates.
