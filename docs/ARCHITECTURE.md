# Architecture and maintenance map

ChapterOne is a CommonJS Electron application. There is no renderer bundler, database server, or ChapterOne backend. The app owns its library and invokes external providers for AI work.

## Process and trust boundaries

`main.js` reconstructs the user's CLI PATH, takes a single-instance lock, initializes OS credential storage and crash recovery, creates menus, and loads `renderer/index.html`. The renderer has context isolation and sandboxing enabled, no Node integration, a restrictive CSP, and navigation guards. `preload.js` exposes individual methods through `window.api`; it does not expose raw IPC or Node APIs.

`ipc.js` is the service layer. Every request must come from the exact top-level app document and returns `{ok:true,data}` or `{ok:false,error}`. It coordinates writing jobs, outline approval, audio, exports, settings and delivery. Generation, resume and rewrite share one writing slot. Destructive operations refuse to run while writing, audio, export or delivery is active. Exported paths are registered before the shell bridge can open them.

Third-party CLIs remain separate installed applications with their own account settings, extensions, lifecycle and update policies. Adapter flags reduce privileges, but ChapterOne is not a complete sandbox around those applications. Custom CLI commands are executable paths and are trusted user configuration.

## Source map

| Module | Responsibility and important constraints |
| --- | --- |
| `main/main.js` | Lifecycle, single instance, window, permissions, menus, OS credential codec |
| `main/preload.js` | Typed-by-convention bridge, variadic invocation, subscriptions and error envelopes |
| `main/security.js` | Trusted document identity, external URL checks, isolated offline sessions |
| `main/ipc.js` | Privileged app operations, job ownership, outline gate, author tools, delivery |
| `main/store.js` | Atomic JSON writes, validated book IDs, settings recovery, secret migration, library summaries and deletion |
| `main/util.js` | Portable export filenames, including Windows reserved names |
| `main/http.js` | Bounded HTTPS bodies, deadlines, cancellation, truncated-response errors |
| `main/cli/models.js` | Provider metadata, model options, presets and environment scrub lists |
| `main/cli/index.js` | Adapter construction, fallback order, prerequisite detection, model verification and npm installation |
| `main/cli/spawn.js` | Shell-free process execution, stdin, streaming, deadlines, process-tree cancellation and Windows npm shim resolution |
| `main/cli/envPath.js` | Finder/login-shell PATH recovery; Windows npm and per-user executable locations |
| `main/cli/loginCommand.js` | Quoting and validation for explicit terminal login commands |
| `main/cli/authSession.js` | Legacy piped-login session helper; current UI login uses a real terminal through IPC |
| `main/cli/claudeAdapter.js` | Claude print mode, restricted built-in tools, MCP config restriction, subscription environment |
| `main/cli/codexAdapter.js` | Codex stdin mode, read-only sandbox, disabled shell, explicit web search, final-text extraction |
| `main/cli/geminiAdapter.js` | Gemini REST/SSE client, API-key authentication, model listing, search grounding and UTF-8 text streaming |
| `main/cli/grokAdapter.js` | Grok invocation, tool restrictions, cached auth detection, model listing and output cleanup |
| `main/cli/chainEngine.js` | Sticky provider fallback and bounded retry/backoff; injected delay keeps unit tests fast |
| `main/book/generator.js` | Clarification, research, outline, review gate, cover, chapters, editing, artwork, recaps, back matter and resume |
| `main/book/prompts.js` | Prompt templates, book sizes, writing modes, continuity, research and character reference-photo extraction |
| `main/book/ageBands.js` | Six audience bands, unit counts, vocabulary instructions, image density, reader/export typography |
| `main/book/classify.js` | Audience and fiction/nonfiction display labels, not a certified content rating |
| `main/book/json.js` | Tolerant JSON extraction from model responses |
| `main/book/errors.js` | Error classification, retry eligibility and user-facing recovery descriptions |
| `main/book/typography.js` | Prose cleanup and speech conversion, preserving fenced/inline code and image markers |
| `main/book/stats.js` | Word counts, estimated reading time/pages and English reading-level heuristics |
| `main/book/revisions.js` | Bounded per-chapter prose snapshots, history validation, comparison metadata, and restore with a snapshot of the replaced prose |
| `main/book/readiness.js` | Offline deterministic manuscript findings with evidence; no provider call or publication-quality guarantee |
| `main/book/aiArt.js` | HTML/SVG extraction and defense-in-depth cleanup; offline rendering is the stronger boundary |
| `main/book/images.js` | Legacy Openverse image sourcing, result ranking, attribution and downloads; retired from new-book UI |
| `main/book/nanoBanana.js` | Opt-in image generation, character references, model/price metadata and non-generating key check |
| `main/book/elevenlabs.js` | Voices, chunked TTS, multipart voice cloning and sample decoding |
| `main/book/audioCache.js` | Narration keys include spoken content, chapter, voice and model; edited chapters get new audio |
| `main/export/sanitize.js` | Allowlisted prose HTML; removes active elements, styles and arbitrary resource URLs |
| `main/export/html.js` | Shared chapter rendering, local raster embedding, cover, credits, CSS and self-contained HTML |
| `main/export/epub.js` | EPUB3 ZIP, stored-first mimetype, OPF, navigation, NCX, XHTML and image resources |
| `main/export/docx.js` | Minimal OOXML text manuscript; no embedded illustration support |
| `main/export/markdown.js` | Plain manuscript export |
| `main/export/pdf.js` | Isolated Electron PDF rendering, temporary-file cleanup, A4 and 6×9-inch pages |
| `main/export/rasterize.js` | Offline HTML/SVG to PNG; reuses a window across book artwork |
| `main/kindle/sendToKindle.js` | SMTP delivery, SMTP verification, macOS Mail draft automation |
| `renderer/app.js` | Vanilla DOM UI: library, adult/kids briefs, provider setup, progress, reader, author tools, audio and deletion confirmation |
| `renderer/styles.css` | Layout, platform chrome, reader themes, typography and animation |
| `renderer/index.html` | Static application shell and content security policy |

## Writing and recovery

1. Optional clarification makes a single call to the selected provider.
2. Generation constructs a fallback chain, studies the requested category, then requests a JSON outline.
3. The outline creates a book ID and is persisted before writing. Optional review pauses at an IPC-controlled gate.
4. A cover is attempted. Each chapter is drafted, optionally edited, saved, then optionally illustrated. The previous chapter's compact recap supplies continuity.
5. Every completed chapter is a checkpoint. Failures after the outline persist a paused draft. Startup reconciles interrupted jobs. Resume starts at the next saved chapter.
6. Back matter is best-effort. Artwork is rasterized before regular exports. Failure of optional art can leave a text-only result.

An in-progress CLI response or editor pass is not a durable checkpoint. A power failure during that response may require repeating the call. Resuming after an illustration failure preserves prose but does not automatically regenerate every missing illustration. Concurrent author edits are blocked while writing to prevent later checkpoints overwriting edits.

## Storage

The directory is Electron's `app.getPath('userData')`; the development package name is `chapterone`. Typical paths are `~/Library/Application Support/chapterone` on macOS and `%APPDATA%/chapterone` on Windows. Packaged naming can follow the product name; consult the OS app-data folder when backing up.

- `books/<id>.json`: brief, answers, outline, manuscript, metadata, reference photos and paths to media.
- `images/<id>/`: generated/downloaded image files and rasterized artwork.
- `audio/<id>/`: content-addressed chapter MP3s.
- `exports/`: temporary/default book and audio exports.
- `settings.json`, `settings.json.bak`: preferences and encrypted credential values. Main-process memory and the settings UI receive decrypted values.
- Chromium local storage: reader preferences, playback positions and device selections.

Books and exports are not encrypted. Credentials use Electron safeStorage (macOS Keychain / Windows DPAPI), so copying settings to another OS account is not a credential migration method. Removing a book deletes its book-specific images/audio; independent exported copies remain. Clear all data removes app-managed library artifacts, settings, backups and reader preferences, but not external exports, provider-side data, CLI credentials or OS backups.

Each chapter can retain up to 20 previous prose revisions in its book JSON. Manual edits, successful AI rewrites and restores preserve the prose being replaced; no-op or failed changes add no version. Restoring changes prose only, preserving current titles, summaries, outline and artwork. Previous or removed text therefore remains locally available while retained, and history is unencrypted like the manuscript. Exports omit revision history. Deleting the book or clearing app data removes app-managed history but not independent backups or exported copies.

## Testing and packaging

`npm run verify` checks source syntax, unit regressions and the complete locked dependency audit. `scripts/smoke.cjs` uses isolated temporary data and a scripted provider while exercising the real app, preload, IPC, renderer and six export formats. It validates 6×9 PDF dimensions, rasterization and untrusted IPC rejection. `--app-root=<path to app.asar>` repeats those checks against packaged code.

CI uses native Intel Mac, Apple Silicon, Windows x64 and Windows ARM64 runners, plus Linux unit tests. `electron-builder.config.js` derives packaging from `package.json`; releases require Mac signing/notarization. Windows Authenticode signing is required unless the owner authorizes an exact-version unsigned Windows exception; this never permits unsigned Mac releases or incomplete signing credentials. `.github/workflows/release.yml` waits for every platform and signature check, generates signing notes and checksums, verifies uploaded file hashes, and publishes the complete release. See [RELEASING.md](RELEASING.md).

## Handbook

`scripts/docs-build.cjs` generates a static handbook from `docs/site/site.json`, the Markdown in `docs/site/content/`, and the existing model, architecture, and release reference documents. It sanitizes rendered content, rewrites repository-relative references, and validates internal links and anchors. `docs/site/assets/` contains local styles and progressive navigation/search; there is no hosted search service or runtime CDN. `.github/workflows/pages.yml` builds/checks the generated output and deploys it from `main` to GitHub Pages.
