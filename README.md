# ChapterOne ✒️ — Your Personal Book Writer

A cross-platform desktop app (macOS `.dmg` + Windows installer) that writes
**professional, bestseller-quality books on demand**. Describe the book you wish
existed; a "#1 bestselling author in that genre" plans it, researches it, writes
it chapter by chapter, illustrates it, and hands you a finished book you can
**read in the app**, **listen to as an audiobook**, **export to Kindle (EPUB) /
PDF / Markdown**, or **email straight to your Kindle**.

The writing runs entirely on **your own AI subscription** by driving the CLI you
already use — **Claude Code**, **Codex**, or **Gemini** — locally. No server,
and no API keys for the writing itself. (Two optional extras — photorealistic
AI illustrations and audiobook narration — use keys *you* provide, for those
features only.)

Made by [Modulagent](https://modulagent.com). MIT licensed.

---

## ✨ What it does

### Writing
- **Commission a book** — describe what you want to read; vague is fine. If the
  brief is ambiguous, the author asks 2–5 sharp clarifying questions first.
- **Fiction or non-fiction**, with tone, POV, audience, and custom characters
  (name + who they are). Set your own author name, or let it invent a pen name.
- **Kids Books studio** — a dedicated flow with age bands (1–2 up to 17–18) that
  automatically tune vocabulary, length, safety, fonts, and illustration density.
- **Book size** — Small (35–60 pages), Medium (75–125), or Large (150–250); the
  planner sizes chapters to land in range without padding.
- **Agentic multi-pass pipeline** — study the genre's top authors → outline →
  research-grounded drafting → an editor pass that rewrites each chapter to
  bestseller quality → rolling continuity recaps so the whole book stays coherent.
- **Research-grounded** — the selected CLI's own web tools (Claude
  WebSearch/WebFetch, Codex `--search`, Gemini Google Search) verify real facts,
  names, places, and dates. Never fabricated sources.
- **Flawless typography** — curly quotes, cleaned markdown, no stray dashes,
  applied at both generation and render time.

### Engines
- **Three engines, your subscription** — Claude Code, Codex, or Gemini, each
  with its own model picker. By default the app strips `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `GEMINI_API_KEY` from the CLI environment so billing always
  uses your plan login.
- **Automatic fallback chain** — order your engines; if one hits its usage limit
  mid-book, writing continues on the next, automatically. Too-short or stub
  responses are rejected, never silently accepted as chapters.
- **One-click setup** — the app detects installed CLIs, can install a missing
  one via npm, and signs you in through your real Terminal (browser OAuth),
  showing per-provider signed-in status.
- **Pause & resume, always** — progress is saved after every chapter. Quota
  lapse, network drop, crash, or cancel leaves a resumable draft; interrupted
  books are recovered on startup so **▶ Continue** always works.

### Art & audio
- **Covers and illustrations** — the engine designs a bespoke vector cover
  (sanitized SVG → rasterized PNG so it shows everywhere, including Kindle
  thumbnails). For illustrations choose: engine-designed vector art,
  openly-licensed stock photos (Openverse, with a credits page), or
  **real AI images** via Google's image API (opt-in: uses a Gemini API key you
  provide, for image calls only, with an upfront cost preview).
- **Audiobooks** — per-chapter narration via ElevenLabs (your key), with
  researched voice picks for adult and kids books, caching, and MP3 export.
  Includes **voice cloning**: record or upload your own voice with a guided
  read-aloud script, then have your books read in it.

### Reading & delivery
- **Premium built-in EPUB reader** — contents drawer, Page/Scroll modes,
  adjustable type, Light/Sepia/Night themes, progress bar, remembered position.
- **Live progress dashboard** — streaming draft preview, word count, elapsed
  time, active engine, chapter checklist, and a timestamped activity feed.
- **Send to Kindle** — email the EPUB to your `@kindle.com` address via your
  SMTP account, or on macOS hand off to **Mail.app** with everything pre-filled
  (no SMTP credentials needed).
- **Export** — Kindle/KDP-ready EPUB, PDF (email it to anyone), Markdown, MP3.
- **Glassy native UI** — follows your system's light/dark appearance.

---

## 🔧 Prerequisites

You need **one** of these CLIs signed in with its subscription (the app can
install and sign in for you from Settings):

| Engine | Install | Subscription |
| --- | --- | --- |
| **Claude Code** (default) | `npm i -g @anthropic-ai/claude-code` | Claude Pro / Max |
| **Codex** | `npm i -g @openai/codex` | ChatGPT Plus / Pro |
| **Gemini** | `npm i -g @google/gemini-cli` | Google account (free tier or AI Pro/Ultra) |

Optional: a Gemini API key for photorealistic illustrations, an ElevenLabs key
for audiobooks. Node.js 18+ if you run from source.

---

## 🚀 Run from source

```bash
npm install
npm start        # launch the app
npm run dev      # launch with DevTools
npm test         # node:test suite (104 specs, no Electron needed)
```

## 📦 Build installers

```bash
npm run dist:mac    # → release/*.dmg  (single universal: Apple Silicon + Intel)
npm run dist:win    # → release/*.exe  (NSIS, x64 + arm64)
npm run dist:all    # both
```

Output lands in `release/`. Drop a 1024×1024 icon at `build/icon.png` and
electron-builder generates all platform icons. For distribution outside the
App Store, code-sign and notarize the macOS build.

---

## 📨 Send to Kindle setup

Amazon delivers personal documents by email. In **Settings → Send to Kindle**:

1. **Your Kindle address** — from *Amazon → Manage Your Content & Devices →
   Preferences → Personal Document Settings* (looks like `yourname@kindle.com`).
2. **Approved sender** — add your sending address to Amazon's *Approved
   Personal Document E-mail List*, or Amazon will reject the message.
3. **Delivery method** — on macOS, choose the **Mail.app hand-off** (no
   credentials; the message opens pre-filled and you press Send), or configure
   SMTP (e.g. Gmail `smtp.gmail.com:587` with an
   [App Password](https://support.google.com/accounts/answer/185833)) for
   one-click sending. Credentials stay on your machine.

---

## 🏗️ Architecture

```
src/
  main/                     Electron main process (Node)
    main.js                 app lifecycle, window, menu
    preload.js              contextBridge → window.api (the only bridge)
    ipc.js                  all IPC handlers ({ok,data} | {ok:false,error})
    store.js                JSON persistence (settings + library + media)
    cli/
      spawn.js              child-process runner (stdin, abort, env scrub, min-words)
      envPath.js            login-shell PATH reconstruction (Finder-launch fix)
      claudeAdapter.js      drives `claude -p` (web tools via --allowedTools)
      codexAdapter.js       drives `codex exec` (--search)
      geminiAdapter.js      drives `gemini -p`
      chainEngine.js        ordered fallback across engines
      authSession.js        interactive sign-in (real Terminal + OAuth)
      models.js             provider catalog, model lists, scrub vars
      index.js              adapter factory, prereq checks, npm installer
    book/
      prompts.js            the full prompt library + sizes + age handling
      generator.js          clarify → outline → cover → chapters(+edit+art) → recap
      ageBands.js           kids age bands → vocabulary/length/density rules
      typography.js         book-grade text cleanup + speech text
      images.js             Openverse stock sourcing (license-filtered)
      nanoBanana.js         optional Gemini image API illustrations
      elevenlabs.js         optional audiobook narration + voice cloning
      aiArt.js              SVG extract/sanitize/data-uri
      errors.js             failure classification (quota/auth/rate/network)
      json.js               tolerant JSON extraction
    export/
      epub.js               hand-rolled EPUB3 (cover, art, images, credits)
      pdf.js                PDF via Electron print
      rasterize.js          SVG → PNG (single reused offscreen window)
      html.js               shared book HTML/CSS
      markdown.js           full-manuscript Markdown
    kindle/
      sendToKindle.js       SMTP + macOS Mail.app hand-off
  renderer/                 UI (vanilla JS — no framework, no build step)
test/                       104 node:test specs for the pure-logic modules
```

### Privacy

The writing runs locally through your CLI on your subscription. Outbound
network happens only for: the CLI's own web research, Openverse image lookups,
the optional image/audio APIs you enable with your own keys, and emails you
explicitly send. Settings — including any keys you add — live in a local JSON
file under your OS user-data directory and are never sent anywhere else.

---

## 🤝 Contributing

PRs welcome. Start with [CLAUDE.md](CLAUDE.md) — it documents the architecture,
conventions, and the non-obvious gotchas (subscription env-scrubbing, the
renderer IIFE, EPUB zip rules, Electron-only modules, and how to smoke-test
headlessly). Run `npm test` before submitting.

## License

[MIT](LICENSE) © 2026 Modulagent
