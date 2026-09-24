# UI review and interaction checks

The 0.3.0 review covers the redesigned workspace and revision tools. Run `npm run test:smoke` to exercise the real Electron main process, preload, sandboxed renderer, persistence, and export code with an isolated temporary library and a scripted provider. No real provider account, microphone, email recipient, or API credit is used. This is broad regression coverage, not a claim that every possible scenario or device has been tested.

## Changes from the review

- Warm editorial light/dark surfaces, consistent typography, library overview/status filters/sorting, guided brief, collapsed creative details, and Settings shortcuts.
- Reader book actions grouped under Book tools; chapter editing/history remains available in Page and Scroll modes. Reader themes remain independent of the app theme.
- Revision history compares saved/current prose, supports restore and recovery of the replaced version, and displays empty/error states. Manuscript check gives actionable chapter links without paid calls.
- Unsaved editor dismissal requires a choice; cancelling an active rewrite stops the writing job and rejects late provider output. Native navigation cannot change the view beneath a modal.
- The reader uses the whole window. Its title, typography controls, and actions wrap without being squeezed beside the sidebar or setup banner. The closed contents drawer cannot receive keyboard focus; chapter editing is disabled on the title/cover pages.
- Library covers are compact, with readable titles/authors outside the cover, explicit status, keyboard-operable book links, searchable tile/list views, counts, and a clear empty-search state.
- Adult and kids screens start with the brief. Engine/model controls live under “Writing options.” Briefs and characters survive navigation within the session. Background connection checks preserve unsaved settings.
- Native modal dialogs provide inert background content, keyboard focus handling, Escape dismissal, and focus restoration. Promise-based confirmations resolve on cancellation. Export options support keyboard navigation and clean up their outside-click handler when the reader closes.
- Research/polish switches are keyboard accessible. Form labels, navigation state, visible focus, muted text, responsive layout, and reduced-motion behavior were improved. Deleting a book reports errors; clearing all data also clears in-memory briefs.

## Automated UI coverage

`scripts/ui-checks.cjs` runs these interaction groups inside the smoke test:

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
12. Revision comparison, cancelled restore, successful restore, recovery of the replaced prose, and unsaved edit dismissal with both keep/discard choices.
13. Local manuscript findings, safe display of hostile text, chapter navigation, and refreshed results after editing.
14. Cancelling an in-flight rewrite, rejecting late output, retrying successfully, and verifying the previous prose is retained.

The library checks include status filtering and title sorting. Screenshots cover light/dark appearance, compact layouts, revision history, and manuscript findings. Review these images as well as the assertions; an overflow check alone cannot establish a usable layout.

The surrounding smoke suite also checks six export formats, actual 6×9 PDF dimensions, SVG rasterization, sandbox configuration, and rejected untrusted IPC/file opening. Revision checks cover real preload calls, persistent versions, hostile preview sanitization, no-op saves, restore/redo, startup recovery, successful/cancelled rewrites, and write/export conflicts. Node tests cover lower-level provider/network, security, persistence, cancellation/resume, art/audio, and export behavior. `npm run docs:check` builds the handbook and checks local links, anchors, and assets; documentation unit tests cover rendering, search data, and safety boundaries.

CI runs the suite on Mac Intel, Mac Apple Silicon, Windows x64, and Windows ARM64, both from source and against the packaged `app.asar`. Reports and screenshots are uploaded in each job's `smoke-*` artifact. See the [latest branch runs](https://github.com/nimeshbuilds/chapterone/actions/workflows/ci.yml?query=branch%3Arelease-readiness). Check that every job passed for the exact commit being released.

Local artifacts are under `artifacts/ui-<platform>-<arch>-source/` or `-packaged/`, with a `report.json` containing completed groups and actual screenshot viewport sizes. The desktop can limit the requested larger window size; the report records the resulting viewport. A failed assertion makes the parent smoke command fail and saves a failure screenshot.

## Still needs hands-on acceptance

- Real CLI installation/login, live text generation, provider fallback/quota recovery, image billing consent, narration/voice cloning, microphones/speakers, Mail/SMTP and Kindle delivery.
- Clean-machine install, launch, upgrade, uninstall, file associations/OS permissions, Gatekeeper/notarization and Windows publisher prompts on the supported OS versions.
- VoiceOver and NVDA, a full contrast/accessibility audit, 200% zoom/reflow, high-contrast mode, long manuscripts/large libraries, unusual display scaling, and sustained generation/reading.
- Physical Intel/Apple Silicon Macs and Windows x64/ARM64 devices; hosted CI does not represent every GPU, display, or OS configuration.

Use the [release acceptance checklist](RELEASING.md#manual-acceptance-before-public-launch) before publishing. Live services and installer acceptance remain separate release gates.
