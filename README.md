<div align="center">

# ChapterOne

### Your Personal Book Writer

**A privacy-first desktop app that ghost-writes complete, professional-quality books — using your own Claude Code, Codex, or Gemini CLI subscription. No servers, no API keys, your machine.**

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

It runs entirely on **your own AI subscription** by driving a CLI you already
have — **Claude Code**, **Codex**, or **Gemini** — locally. There is **no
backend and no text API key**: your subscription login does the work, and your
book never leaves your machine except for the research, image, and delivery
calls you explicitly enable.

## ⬇️ Download

**[→ Download the latest macOS release](https://github.com/npandeya/bookwriter/releases/latest)**

- **macOS** — universal `.dmg` (Apple Silicon + Intel), **signed & notarized** (no Gatekeeper warning). Double-click → drag to Applications → open.
- **Windows** — planned for a future release. For now, [build from source](#-build-from-source).

You also need one AI CLI installed and signed in — see [Requirements](#-requirements).

## ✨ Features

- 📖 **Writes complete books** — fiction, non-fiction, or **kids' books**, from a vague idea. A planner outlines it, a research-grounded writer drafts each chapter, and an editor pass polishes it to bestseller quality.
- 🧒 **Kids' mode** — age bands (1–2 … 17–18) automatically drive vocabulary, length, reading level, safety, font size, and illustration density. Add custom characters named after real people.
- 🔀 **Three engines + automatic fallback** — Claude Code, Codex, or Gemini, each on your own subscription and each with its own model. Build an ordered chain so writing continues on the next engine if one hits a quota mid-book.
- 🔎 **Research-grounded** — uses each CLI's own web tools (Claude WebSearch/WebFetch, Codex `--search`, Gemini Google Search) to ground real facts, names, and dates. Read-only web access only — never file or shell access.
- 🎨 **AI illustrations** — bespoke vector covers and chapter art designed by the engine (sanitized SVG → rasterized PNG), or photorealistic illustrations via **Nano Banana** (your own Gemini image key), or royalty-free [Openverse](https://openverse.org) stock photos with a full credits page.
- 🎧 **Audiobooks (ElevenLabs)** — narrate per chapter or the **whole book**, with saved playback position. Pick from top audiobook voices, or **clone your own voice** and have it read to you. On-demand, cached, and exportable to MP3.
- 📚 **Premium built-in EPUB reader** — distraction-free, with a contents drawer, Page/Scroll modes, adjustable type, Light/Sepia/Night themes, a progress bar, and remembered position.
- 📨 **Export & deliver** — reflowable EPUB and PDF export, plus **Send to Kindle** (Mail hand-off with no setup, or one-click SMTP).
- ⏯️ **Resumable & loss-proof** — progress is saved after every chapter and every narrated chapter, so a crash, cancel, or lapsed subscription always leaves a resumable draft.
- 🔒 **Subscription, not API key** — `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` are stripped from the CLI's environment so it always authenticates with your plan login.
- 🧹 **Your data, your control** — everything is stored locally; a **Clear all my data** control wipes every artifact (books, art, audio, exports, keys) with a type-to-confirm gate.

## 🧩 Requirements

You need **one** of the following installed and signed in **with your own
subscription** (the app can install and sign you in for you):

| Engine | Install | Sign in |
| --- | --- | --- |
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` | run `claude` and log in with your Claude subscription |
| **Codex** | install the OpenAI Codex CLI | run `codex` and log in with ChatGPT |
| **Gemini** | install the Gemini CLI | run `gemini` and log in with your Google account |

Optional, opt-in keys (stored locally, never used for text): a **Gemini API key**
for Nano Banana illustrations, and an **ElevenLabs API key** for audiobook
narration. Plus **Node.js 18+** to run from source.

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
