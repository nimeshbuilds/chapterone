<div align="center">

<img src="build/icon.png" alt="ChapterOne" width="120" height="120" />

# ChapterOne

### Your Personal Book Writer

**A privacy-first desktop app that ghost-writes complete, professional-quality books — on your own Claude Code, Codex, or Grok subscription (or a Gemini API key). No servers, no accounts, your machine.**

[![Download](https://img.shields.io/badge/download-macOS%20DMG-111?logo=apple&logoColor=white)](https://github.com/npandeya/bookwriter/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/macOS-universal-black?logo=apple)](https://github.com/npandeya/bookwriter/releases/latest)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Tests &amp; audit](https://github.com/npandeya/bookwriter/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/npandeya/bookwriter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/npandeya/bookwriter/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/npandeya/bookwriter/actions/workflows/codeql.yml)

[Download](#-download) · [Features](#-features) · [How it works](#-how-it-works) · [Security](#-security) · [Build from source](#-build-from-source) · [Contributing](CONTRIBUTING.md)

</div>

---

ChapterOne turns a one-line idea into a finished book. You describe what you wish
existed; a "#1 bestselling author in that genre" plans it, researches it, writes
and edits it chapter by chapter, optionally illustrates and narrates it, and
hands you a manuscript you can **read in the app**, **listen to as an audiobook**,
**export to EPUB/PDF**, or **send straight to your Kindle**.

It runs entirely on **your own AI plan** by driving a CLI you already have —
**Claude Code**, **Codex**, or **Grok** on their subscription logins, or
**Gemini** via your API key (Google retired its CLI login). There is **no
backend and no ChapterOne account**: your plan does the work, and your book
never leaves your machine except for the research, image, and delivery calls
you explicitly enable.

## ⬇️ Download

**[→ Download the latest macOS release](https://github.com/npandeya/bookwriter/releases/latest)**

- **macOS** — universal `.dmg` (Apple Silicon + Intel), **signed & notarized** (no Gatekeeper warning). Double-click → drag to Applications → open.
- **Windows** — an NSIS installer (`.exe`, x64 + arm64, per-user, no admin) builds from this repo with `npm run dist:win`. It isn't code-signed yet, so SmartScreen shows a "More info → Run anyway" prompt on first launch. Prebuilt Windows downloads are planned for a future release.

You also need one AI CLI installed and signed in — see [Requirements](#-requirements).

## ✨ Features

- 📖 **Writes complete books** — fiction, non-fiction, or **kids' books**, from a vague idea. A planner outlines it, a research-grounded writer drafts each chapter, and an editor pass polishes it to bestseller quality.
- 🧒 **Kids' mode** — age bands (1–2 … 17–18) automatically drive vocabulary, length, reading level, safety, font size, and illustration density. Add custom characters named after real people, and **upload a photo per character** so Nano Banana draws the art to resemble them.
- 🔀 **Four engines + automatic fallback** — **Claude Code, Codex, Gemini, and Grok**, each on your own subscription and each with its own model. Build an ordered chain so writing continues on the next engine if one hits a quota mid-book — and a transient network blip is **retried** rather than failing the book.
- ⚡ **One-click model presets** — **Fast / Pro / Default** buttons set the right model on *every* engine in your chain at once (Fast → Haiku / GPT-5.4-mini / Flash-Lite / Composer 2.5; Pro → Opus / GPT-5.5 / Gemini 3.1 Pro / Grok Build). Or type a **custom model id** with live ✓/✗ verification against the real provider.
- 🔎 **Research-grounded** — uses each CLI's own web tools (Claude WebSearch/WebFetch, Codex web search, Gemini Google Search, Grok bounded web search on the author-study step) to ground real facts, names, and dates. Read-only web access only — never file or shell access.
- 🎨 **AI illustrations** — bespoke **HTML/CSS + inline-SVG scene illustrations** of each chapter, designed by your engine and rendered to PNG (free, on your subscription), or photorealistic art via **Nano Banana** (your own Gemini image key, with optional per-character reference photos).
- 📋 **Outline review gate** — approve the chapter plan *before* a word is written: retitle chapters, rewrite what happens, or cut chapters, then hit "Approve & start writing".
- 📖 **Read while it writes** — open the reader the moment chapter 1 lands; new chapters appear as they're written, with a live banner and a tap to load them — generation keeps running in the background.
- ✍️ **Author tools** — **rewrite any chapter with a director's note** ("slower pacing, end on a cliffhanger"), or **edit the Markdown by hand**; rename the book and put your own name on it. A **story bible** shows the premise, style guide, cast, and chapter map; **book stats** show words, pages, reading time, and reading level.
- 📚 **Write the sequel** — one click on any finished book prefills a sequel brief with the same world, cast (and their photos), and voice.
- 🎁 **Finishing touches** — every book gets a back-cover **blurb** and a **dedication**, a title page, and a **book-is-born reveal** (cover flip + confetti) when it finishes. The blank-page problem is solved with tappable **idea sparks** and a 🎲 Surprise me.
- 🗂️ **Library that scales** — **Tiles / List** views (uncropped full covers; Finder-style list with a Created date), and every book auto-labelled by the publishing-standard **audience tier** (Board Book · Ages 1–2 … Young Adult … Adult · Fiction/Nonfiction).
- 🎧 **Audiobooks (ElevenLabs)** — narrate per chapter or the **whole book**, with saved playback position. Pick from top audiobook voices, or **clone your own voice** and have it read to you. On-demand, cached, and exportable to MP3.
- 📚 **Premium built-in EPUB reader** — distraction-free, with a contents drawer, Page/Scroll modes, adjustable type, Light/Sepia/Night themes, a progress bar, and remembered position.
- 📨 **Export & deliver everywhere** — EPUB, PDF, **print-ready 6×9 PDF (KDP interior)**, **Word (.docx)** for human editors, a **single-file web page** to share with anyone, and Markdown — plus **Send to Kindle** (Mail hand-off with no setup, or one-click SMTP).
- ⏯️ **Resumable, cancellable & loss-proof** — progress is saved after every chapter; **Pause/Cancel** stops promptly at any time, and a crash or lapsed subscription always leaves a resumable draft.
- 🔒 **Subscription, not API key** — `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` are stripped from the CLI's environment so it always authenticates with your plan login.
- 🧹 **Your data, your control** — everything is stored locally; a **Clear all my data** control wipes every artifact (books, art, audio, exports, keys) with a type-to-confirm gate.

## 🧩 Requirements

You need **one** of the following installed and signed in **with your own
subscription** (the app can install and sign you in for you):

| Engine | Install | Sign in |
| --- | --- | --- |
| **[Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)** | `npm i -g @anthropic-ai/claude-code` | `claude /login` — authorize your Claude Pro/Max plan |
| **[Codex](https://developers.openai.com/codex/cli)** | `npm i -g @openai/codex` | `codex login` — sign in with ChatGPT |
| **[Gemini](https://github.com/google-gemini/gemini-cli)** | `npm i -g @google/gemini-cli`* | run `gemini`, choose **Login with Google** (Gemini AI Pro/Ultra) |
| **[Grok](https://docs.x.ai/build/cli)** | `npm i -g @xai-official/grok` | `grok login` — sign in with xAI (SuperGrok / X Premium Plus) |

> \* Gemini's CLI login was retired by Google for individuals — ChapterOne drives
> Gemini through its REST API with a **Gemini API key** instead (no subscription
> CLI). The other three use your subscription login, no API key.

> 💡 You don't have to use a terminal — ChapterOne can **install a CLI and walk
> you through sign-in** from **Settings**, and shows which engines are ready.

Optional, opt-in keys (stored locally, never used for text): a **Gemini API key**
for [Nano Banana](https://aistudio.google.com/apikey) illustrations, and an
**[ElevenLabs](https://elevenlabs.io) API key** for audiobook narration. Plus
**Node.js 18+** to run from source.

## 🏗️ How it works

ChapterOne treats book-writing as a small multi-agent pipeline, leaning on each
CLI's agentic abilities (web search, long context, tool use):

1. **Triage** — decides whether the brief is clear or needs 2–5 clarifying questions.
2. **Planner** — designs the title, premise, style guide, and a concrete chapter outline (optionally research-grounded).
3. **Writer** — drafts each chapter in its own call, grounded by research and the style guide, carrying only the *previous* chapter's compact continuity recap — so no single context has to hold the whole book.
4. **Editor** — a second pass critiques and rewrites the draft to bestseller quality (toggleable).
5. **Illustrator** — designs the cover and chapter art, or sources openly-licensed images and builds a credits page.
6. **Narrator** — optionally turns each chapter into audio with ElevenLabs, cached per chapter so chapter-by-chapter and whole-book listening both work.
7. **Fallback chain** — every model call runs through your engine chain, so a quota/auth/network failure transparently switches engines. Progress is saved after every chapter.

### Architecture

```
src/
  main/                     Electron main process (Node)
    main.js                 app lifecycle, window, menu, permissions
    preload.js              the only renderer↔main bridge (window.api)
    ipc.js                  all IPC handlers (settings, generate, audio, export, kindle)
    store.js                JSON persistence (settings + library + images/audio/exports)
    cli/                    CLI adapters (claude/codex/gemini), chain engine, auth, spawn
    book/                   prompts, generator pipeline, typography, images, AI art
    export/                 EPUB3, PDF, Markdown, SVG→PNG rasterizer
    kindle/                 Send-to-Kindle (Mail hand-off + SMTP)
  renderer/                 UI — vanilla HTML/CSS/JS, no build step
test/                       node:test suite for the pure-logic modules
```

There is **no native dependency and no renderer build step** — the UI is plain
HTML/CSS/JS, and persistence, EPUB, and the rest are hand-rolled to keep
packaging trivial. See [`CLAUDE.md`](CLAUDE.md) for a deeper architecture guide
and contributor gotchas.

### Privacy

Everything runs locally through your CLI on your subscription. Outbound network
happens only for: research web search (performed by the CLI), opt-in image
generation/lookups, opt-in audiobook narration, and the Send-to-Kindle email you
trigger explicitly. See [`SECURITY.md`](SECURITY.md).

## 🔒 Security

[![Tests &amp; audit](https://github.com/npandeya/bookwriter/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/npandeya/bookwriter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/npandeya/bookwriter/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/npandeya/bookwriter/actions/workflows/codeql.yml)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot)](.github/dependabot.yml)

> ℹ️ Live status badges populate once the repository is **public** (badge services can't read a private repo). They show as "no status" / not-found until then.

Security is enforced automatically on every push and pull request:

- **Dependency audit** — CI runs `npm audit` and **fails the build** on any
  high/critical vulnerability in shipped dependencies. _(passing today —
  0 known vulnerabilities in runtime dependencies.)_
- **CodeQL** — GitHub's static analysis (SAST) scans the JavaScript for
  vulnerabilities and quality issues on every push/PR plus a weekly run.
  Findings publish to the repository's Security tab once the repo is public
  (CodeQL is free for open-source) or with GitHub Advanced Security.
- **Dependabot** — weekly automated dependency-update PRs and security alerts
  for both app and build dependencies.

The app itself is **local-first**: no backend, your subscription login (not API
keys) does the work, the model gets only read-only web tools, all model-produced
SVG is sanitized, and outbound network is limited to the calls you explicitly
enable. Full details and how to report a vulnerability are in
[`SECURITY.md`](SECURITY.md).

## 🚀 Build from source

```bash
npm install
npm start            # launch the app
npm run dev          # launch with DevTools
npm test             # run the test suite
npm run dist:mac     # build a universal .dmg → release/
```

To sign and notarize a macOS build for distribution, see [`SIGNING.md`](SIGNING.md).

## 🧪 Tests

`npm test` runs the Node test suite (109 tests) covering the prompt library,
JSON extraction, the generation **and resume** pipeline (scripted fake engine),
error classification, image marker parsing/licensing, typography, the ElevenLabs
and Nano Banana clients, the store (including the data-wipe), model config, and
EPUB/HTML/Markdown export. Electron-only modules are exercised by a headless
boot smoke test.

## 🤝 Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
our [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Good first steps: open an issue to
discuss an idea, run `npm test`, and keep changes dependency-light.

## 📄 License

[MIT](LICENSE) © Modulagent. ChapterOne drives third-party CLIs and APIs
(Claude Code, Codex, Gemini, ElevenLabs, Openverse) under your own accounts and
their respective terms.
