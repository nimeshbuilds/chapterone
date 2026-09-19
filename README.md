<div align="center">

<img src="build/icon.png" alt="ChapterOne" width="120" height="120" />

# ChapterOne

### Your Personal Book Writer

**A desktop writing app for macOS and Windows. Plan, draft, illustrate, narrate, and export books using your own AI provider accounts. Your library is local; AI generation uses cloud services.**

[![Download](https://img.shields.io/badge/download-macOS%20%2B%20Windows-111?logo=apple&logoColor=white)](https://github.com/nimeshbuilds/chaperone/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/macOS-universal-black?logo=apple)](https://github.com/nimeshbuilds/chaperone/releases/latest)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Tests &amp; audit](https://github.com/nimeshbuilds/chaperone/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nimeshbuilds/chaperone/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nimeshbuilds/chaperone/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/nimeshbuilds/chaperone/actions/workflows/codeql.yml)

[Download](#-download) · [Features](#-features) · [How it works](#-how-it-works) · [Security](#-security) · [Build from source](#-build-from-source) · [Contributing](CONTRIBUTING.md)

</div>

---

ChapterOne turns a one-line idea into a finished book. You describe what you wish
existed; an AI writing pipeline plans it, researches it, writes
and edits it chapter by chapter, optionally illustrates and narrates it, and
hands you a manuscript you can **read in the app**, **listen to as an audiobook**,
**export to EPUB/PDF**, or **send straight to your Kindle**.

ChapterOne has no backend or separate account. It invokes **Claude Code**, **Codex**, or **Grok** on your computer, or calls **Gemini's REST API** with your API key. Prompts, manuscript excerpts, and continuity notes are sent to your chosen providers, including fallback engines you enable. Provider terms, privacy policies, and usage limits apply.

## ⬇️ Download

**[Releases and installers](https://github.com/nimeshbuilds/chaperone/releases)**

The release workflow builds the following assets. Download only assets actually attached to a published release; older releases may contain only the macOS build.

| Platform | Supported systems | Installer |
| --- | --- | --- |
| macOS | macOS 13 Ventura or newer, Intel and Apple Silicon | `ChapterOne-<version>-mac-universal.dmg` (or `.zip`) |
| Windows x64 | Windows 10 or 11, 64-bit Intel/AMD | `ChapterOne-<version>-win-x64-setup.exe` |
| Windows ARM64 | Windows 11 on ARM | `ChapterOne-<version>-win-arm64-setup.exe` |

On macOS, open the DMG and drag the app to Applications. On Windows, run the installer; it installs for the current user and provides shortcuts and an uninstaller. The app includes its own runtime.

Tagged macOS releases require Developer ID signing and notarization. Windows signing is optional and the release notes must state its status; unsigned installers may trigger SmartScreen. CI artifacts are unsigned test builds. Verify downloads against the release's `SHA256SUMS.txt` (`shasum -a 256 <file>` on macOS; `Get-FileHash <file> -Algorithm SHA256` in PowerShell).

Older macOS releases, Windows 7/8, and 32-bit processors are unsupported. This follows the [Electron runtime baseline](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support). Provider CLIs may have additional requirements. Linux source development is possible, but Linux installers are not part of the supported release matrix.

## ✨ Features

- 📖 **Writes complete books** — fiction, non-fiction, or **kids' books**, from a vague idea. A planner outlines it, a research-grounded writer drafts each chapter, and an editor pass revises the draft.
- 🧒 **Kids' mode** — age bands (1–2 … 17–18) automatically drive vocabulary, length, reading level, safety, font size, and illustration density. Add custom characters named after real people, and **upload a photo per character** so Nano Banana draws the art to resemble them.
- 🔀 **Four engines + automatic fallback** — **Claude Code, Codex, Gemini, and Grok**, each with its own model; Gemini uses API billing. Build an ordered chain so writing continues on the next engine if one hits a quota mid-book — and a transient network blip is **retried** rather than failing the book.
- ⚡ **One-click model presets** — **Fast / Pro / Default** buttons set the right model on *every* engine in your chain at once (Fast → Haiku / GPT-5.4-mini / Flash-Lite / Composer 2.5; Pro → Opus / GPT-5.5 / Gemini 3.1 Pro / Grok Build). Or type a **custom model id** with live ✓/✗ verification against the real provider.
- 🔎 **Research-grounded** — uses each provider’s web tools (Claude WebSearch/WebFetch, Codex web search, Gemini Google Search, Grok bounded web search on the author-study step) to ground real facts, names, and dates. The adapters restrict tools where the CLI supports it; see the security policy for the limits of third-party CLI configuration.
- 🎨 **AI illustrations** — bespoke **HTML/CSS + inline-SVG scene illustrations** of each chapter, designed by your engine and rendered to PNG (uses your writing provider’s quota), or photorealistic art via **Nano Banana** (your own Gemini image key, with optional per-character reference photos).
- 📋 **Outline review gate** — approve the chapter plan *before* a word is written: retitle chapters, rewrite what happens, or cut chapters, then hit "Approve & start writing".
- 📖 **Read while it writes** — open the reader the moment chapter 1 lands; new chapters appear as they're written, with a live banner and a tap to load them — generation keeps running in the background.
- ✍️ **Author tools** — **rewrite any chapter with a director's note** ("slower pacing, end on a cliffhanger"), or **edit the Markdown by hand**; rename the book and put your own name on it. A **story bible** shows the premise, style guide, cast, and chapter map; **book stats** show words, pages, reading time, and reading level.
- 📚 **Write the sequel** — one click on any finished book prefills a sequel brief with the same world, cast (and their photos), and voice.
- 🎁 **Finishing touches** — books can receive a back-cover **blurb** and a **dedication**, a title page, and a **book-is-born reveal** (cover flip + confetti) when it finishes. The blank-page problem is solved with tappable **idea sparks** and a 🎲 Surprise me.
- 🗂️ **Library that scales** — **Tiles / List** views (uncropped full covers; Finder-style list with a Created date), and every book auto-labelled by the publishing-standard **audience tier** (Board Book · Ages 1–2 … Young Adult … Adult · Fiction/Nonfiction).
- 🎧 **Audiobooks (ElevenLabs)** — narrate per chapter or the **whole book**, with saved playback position. Pick from top audiobook voices, or **clone your own voice** and have it read to you. On-demand, cached, and exportable to MP3.
- 📚 **Built-in book reader** — distraction-free, with a contents drawer, Page/Scroll modes, adjustable type, Light/Sepia/Night themes, a progress bar, and remembered position.
- 📨 **Export & deliver everywhere** — EPUB, PDF, **6×9 PDF interior**, **Word (.docx)** for human editors, a **single-file web page** to share with anyone, and Markdown — plus **Send to Kindle** (macOS Mail draft, Windows file hand-off, or SMTP on either platform).
- ⏯️ **Resumable and cancellable** — progress is saved after every chapter; **Pause/Cancel** stops promptly at any time, and completed chapters remain available after an interruption; an unfinished model response may need to be retried.
- 🔒 **Subscription, not API key** — `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` are stripped from the CLI's environment to prefer your plan login; existing CLI authentication and configuration still apply.
- 🧹 **Your data, your control** — your library is stored locally; a **Clear all my data** control erases the app-managed books, art, audio, exports, settings, and credential backups with a type-to-confirm gate.

## 🧩 Requirements

Configure at least one writing provider in Settings:

| Engine | Setup | Authentication |
| --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/overview) | `npm i -g @anthropic-ai/claude-code` | Sign in using the provider's CLI |
| [Codex](https://developers.openai.com/codex/cli) | `npm i -g @openai/codex` | `codex login` |
| [Grok](https://docs.x.ai/build/cli/reference) | `npm i -g @xai-official/grok` | `grok login` |
| [Gemini API](https://aistudio.google.com/apikey) | Add an API key in Settings | API key; separately billed usage |

The packaged desktop app does not need a separate Node installation. The optional **Install CLI** buttons do require Node.js with npm on PATH. Source development requires **Node.js 22.12+**. Use current provider CLI versions; CLI flags, account entitlements, and available models can change independently of ChapterOne. The Default choice honors your CLI configuration; it does not guarantee access to the newest model. See the [current model catalog, presets, and retirement notices](docs/MODELS.md).

Optional services: the same Gemini key can generate Nano Banana images; an [ElevenLabs](https://elevenlabs.io) key enables narration and voice cloning. Uploaded character photos go to Google when image generation uses them, and voice samples go to ElevenLabs when cloning. API usage is billed by the provider. Checking a Gemini/image key does not generate a paid sample.

This app uses Gemini's REST API by design. [Google login remains available in the separate Gemini CLI](https://geminicli.com/docs/get-started/authentication/).

## 🏗️ How it works

ChapterOne treats book-writing as a small multi-agent pipeline, leaning on each
CLI's agentic abilities (web search, long context, tool use):

1. **Triage** — decides whether the brief is clear or needs 2–5 clarifying questions.
2. **Planner** — designs the title, premise, style guide, and a concrete chapter outline (optionally research-grounded).
3. **Writer** — drafts each chapter in its own call, grounded by research and the style guide, carrying only the *previous* chapter's compact continuity recap — so no single context has to hold the whole book.
4. **Editor** — a second pass critiques and rewrites the draft (toggleable).
5. **Illustrator** — designs the cover and chapter art with the writing engine, or uses the optional image API.
6. **Narrator** — optionally turns each chapter into audio with ElevenLabs, cached per chapter so chapter-by-chapter and whole-book listening both work.
7. **Fallback chain** — writing calls run through your engine chain, so a quota/auth/network failure transparently switches engines. Progress is saved after every chapter.

### Architecture

```
src/
  main/                     Electron main process (Node)
    main.js                 app lifecycle, window, menu, permissions
    preload.js              the only renderer↔main bridge (window.api)
    ipc.js                  all IPC handlers (settings, generate, audio, export, kindle)
    store.js                JSON persistence (settings + library + images/audio/exports)
    cli/                    Claude/Codex/Grok CLI adapters, Gemini REST, chain, auth, spawn
    book/                   prompts, generator pipeline, typography, images, AI art
    export/                 EPUB3, PDF, DOCX, HTML, Markdown, art rasterization
    kindle/                 Send-to-Kindle (Mail hand-off + SMTP)
  renderer/                 UI — vanilla HTML/CSS/JS, no build step
test/                       node:test suite for the pure-logic modules
```

There is **no native dependency and no renderer build step** — the UI is plain
HTML/CSS/JS, and persistence, EPUB, and the rest are hand-rolled to keep
packaging trivial. See [the architecture guide](docs/ARCHITECTURE.md) and [CLAUDE.md](CLAUDE.md) for the source map and contributor conventions.

### Privacy

Library files remain in the OS app-data folder. AI prompts and relevant book context are sent to the configured text engines; research, illustrations, narration, voice cloning, and email introduce their own provider requests. There is no ChapterOne analytics or backend service. See [SECURITY.md](SECURITY.md) for storage, network flows, and deletion limits.

## 🔒 Security

[![Tests &amp; audit](https://github.com/nimeshbuilds/chaperone/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nimeshbuilds/chaperone/actions/workflows/ci.yml)
[![CodeQL](https://github.com/nimeshbuilds/chaperone/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/nimeshbuilds/chaperone/actions/workflows/codeql.yml)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot)](.github/dependabot.yml)

> ℹ️ Live status badges populate once the repository is **public** (badge services can't read a private repo). They show as "no status" / not-found until then.

CI audits dependencies on every branch push and pull request; additional security automation includes:

- **Dependency audit** — CI runs `npm audit` and **fails the build** on any
  high/critical vulnerability in the full locked dependency tree, including Electron and build tools.
- **CodeQL** — GitHub's static analysis (SAST) scans the JavaScript for
  vulnerabilities and quality issues on main-branch pushes, pull requests and a weekly run.
  Findings publish to the repository's Security tab once the repo is public
  (CodeQL is free for open-source) or with GitHub Advanced Security.
- **Dependabot** — weekly automated dependency-update PRs and security alerts
  for both app and build dependencies.

The app uses a sandboxed renderer, validates IPC senders, sanitizes generated book HTML, isolates offline art/PDF rendering, and protects saved API keys and SMTP passwords with the OS credential store. See [SECURITY.md](SECURITY.md).

## 🚀 Build from source

```bash
npm ci
npm start
npm run verify       # syntax, unit tests, full dependency audit
npm run test:smoke   # actual Electron UI, IPC, generation, and exports; no AI account
npm run dist:mac     # universal DMG + ZIP; run on macOS
npm run dist:win     # x64 + ARM64 NSIS installers; run on Windows
```

Builds go into `release/`. CI builds and tests on Intel Mac, Apple Silicon, Windows x64, and Windows ARM64, and runs unit tests on Linux. Installer smoke tests also load the packaged ASAR to catch missing runtime files. These do not replace clean-machine installation, signing, accessibility, or live-provider testing.

See [SIGNING.md](SIGNING.md), [the release procedure](docs/RELEASING.md), [architecture](docs/ARCHITECTURE.md), and [release readiness and feature priorities](docs/RELEASE_READINESS.md).

## Known limitations

- AI output needs human editing and fact checking. Research does not produce a verified bibliography; age-band prompts do not certify child safety.
- DOCX currently exports formatted text without illustrations. The reader displays ChapterOne books, not arbitrary imported EPUBs. Back matter varies by export format.
- The 6×9 PDF is a trim-size option, not a guarantee of publishing-platform acceptance; review margins, page count, bleed, fonts, and imagery before printing.
- There is no library backup/import UI or automatic updater yet. Keep independent exports and back up the app-data folder while the app is closed. Encrypted credentials are tied to the OS account.
- Paid narration cannot yet be cancelled from the UI. Wait for it to finish before deleting a book or clearing data.

## 🤝 Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Good first steps: open an issue to
discuss an idea, run `npm test`, and keep changes dependency-light.

## 📄 License

[MIT](LICENSE) © Modulagent. ChapterOne drives third-party CLIs and APIs
(Claude Code, Codex, Grok, Gemini, ElevenLabs, Openverse) under your own accounts and
their respective terms.
