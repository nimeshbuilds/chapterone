# Modulagent's Book Writer ✒️

A cross-platform desktop app (macOS `.dmg` + Windows installer) that writes
**professional, bestseller-quality books on demand**. You describe the book you
wish existed; a "#1 bestselling author in that genre" plans it, researches it,
writes it chapter by chapter, and hands you a finished manuscript you can
**read in the app**, **export to Kindle (EPUB) / PDF / Markdown**, or **email
straight to your Kindle**.

It runs entirely on **your own AI subscription** by driving the CLI you already
use — the **Claude Code CLI** or the **Codex CLI** — locally. No API keys, no
third-party servers.

---

## ✨ What it does

- **Commission a book** — describe what you want to read. Vague is fine.
- **Pick your engine & model** — switch between Claude Code and Codex and choose
  the model (Sonnet/Opus/Haiku, GPT-5/Codex, or a custom id) right on the create
  screen, before you write.
- **Smart clarification** — if the brief is ambiguous, the author asks 2–5
  sharp questions (with suggested answers) before writing.
- **Agentic, multi-pass writing** — a planner designs the outline, a
  research-grounded writer drafts each chapter, and an **editor agent** then
  revises it to bestseller quality, with rolling continuity notes keeping the
  whole book coherent.
- **Research-grounded** — with web search enabled, the author looks up real
  facts, places, names, dates and current details so the book is authentic and
  accurate — never fabricated. The searching is done by the selected CLI's own
  web tools (Claude WebSearch/WebFetch, Codex `--search`, Gemini Google Search).
- **Three engines + automatic fallback chain** — Claude Code, Codex, or Gemini,
  each on your own subscription. Build an ordered chain so that if one provider's
  quota runs out mid-book, writing continues automatically on the next.
- **Guided sign-in** — not logged in? The app launches the CLI's sign-in,
  opens the OAuth page in your browser, and accepts any pasted code — no terminal
  needed.
- **Royalty-free images** — optionally illustrates the book with openly-licensed
  / public-domain images sourced from [Openverse](https://openverse.org), with a
  full image-credits page (no copyright headaches).
- **Bestseller pipeline** — concept & title → full chapter outline →
  chapter-by-chapter prose that stays coherent via a rolling continuity recap.
- **Pause & resume** — progress is saved after every chapter. If your
  subscription lapses, the network drops, or you hit a rate limit mid-book, the
  book is saved exactly where it stopped. Reactivate and hit **▶ Continue** (or
  resume any paused book from the library) to finish it.
- **Premium built-in EPUB reader** — read your books in a distraction-free,
  book-grade reader with a contents drawer, Page or Scroll modes, adjustable
  type size and typeface, Light/Sepia/Night themes, a reading-progress bar, and
  remembered position. EPUB is the canonical format.
- **Send to Kindle** — emails the **EPUB** to your `@kindle.com` address so it
  appears on your device, and gives you a KDP-ready EPUB to publish for others.
- **Export to PDF & email** — one button renders a PDF and emails it to any
  address you choose, through your own SMTP account.
- **Download EPUB** — save the Kindle/KDP-ready `.epub` file anywhere.
- **Subscription, not API key** — by default the app strips `ANTHROPIC_API_KEY`
  / `OPENAI_API_KEY` from the CLI's environment so it always authenticates with
  your subscription login and never bills an API key.
- **Prerequisite checks** — detects whether your chosen CLI is installed and
  authenticated, with a one-click connection test.

---

## 🔧 Prerequisites

You need **one** of the following installed and signed in **with your
subscription** (Claude Pro/Max or ChatGPT/Codex):

| Engine | Install | Sign in |
| --- | --- | --- |
| **Claude Code** (default) | `npm i -g @anthropic-ai/claude-code` | run `claude` and log in with your subscription |
| **Codex** | install the OpenAI Codex CLI | run `codex` and log in with ChatGPT |

Plus **Node.js 18+** if you run from source.

---

## 🚀 Run from source

```bash
npm install
npm start        # launch the app
npm run dev      # launch with DevTools
npm test         # run the unit/integration test suite (42 tests)
```

## 📦 Build installers

```bash
npm run dist:mac    # → release/*.dmg  (universal: arm64 + x64)
npm run dist:win    # → release/*.exe  (NSIS installer)
npm run dist:all    # both
```

Output lands in `release/`. To brand the app, drop an icon at
`build/icon.png` (1024×1024) — electron-builder generates the platform icons
automatically. macOS distribution outside the App Store should be code-signed
and notarized.

---

## 🔎 Research & 🖼️ images

Both are toggles on the create screen (and Settings):

- **Research real facts & sources** — enables the CLI's web tools
  (`WebSearch`/`WebFetch` for Claude, `--search` for Codex) so the author
  verifies real-world detail. Only read-only web tools are allowed — the app
  never grants file-editing or shell access to the model.
- **Add royalty-free images** — the author may insert image markers, which the
  app resolves against Openverse filtered to permissive licenses
  (CC0 → Public Domain → CC-BY → CC-BY-SA), downloads, embeds, and credits.
  If a query can't be resolved, the caption is simply kept as text — nothing
  breaks.

---

## 📨 Send to Kindle setup

Amazon delivers personal documents by email. In **Settings → Send to Kindle**:

1. **Your Kindle address** — from *Amazon → Manage Your Content & Devices →
   Preferences → Personal Document Settings* (looks like `yourname@kindle.com`).
2. **Approved sender** — add your sending email to Amazon's *Approved Personal
   Document E-mail List*, or Amazon will reject the message.
3. **SMTP credentials** — e.g. Gmail `smtp.gmail.com:587` with an
   [App Password](https://support.google.com/accounts/answer/185833). Stored
   locally; used only to send from your own account.

Click **Verify SMTP** to test, then **📨 Send to Kindle** from any book.

---

## 🏗️ Architecture

```
src/
  main/                     Electron main process (Node)
    main.js                 app lifecycle, window, menu
    preload.js              safe contextBridge API → renderer (window.api)
    ipc.js                  IPC handlers (settings, generate, resume, export, kindle)
    store.js                JSON persistence (settings + book library + images)
    cli/
      spawn.js              child-process runner (stdin, abort, timeout, env scrub)
      claudeAdapter.js      drives `claude -p` (subscription auth + web tools)
      codexAdapter.js       drives `codex exec` (subscription auth + --search)
      models.js             per-provider model lists + API-key scrub config
      index.js              engine factory + prerequisite checks
    book/
      prompts.js            the "bestselling author" prompt library
      generator.js          clarify → outline → chapters pipeline + resume()
      errors.js             failure classification (subscription/auth/rate/net)
      images.js             Openverse image sourcing + marker resolution
      json.js               robust JSON extraction from model output
    export/
      html.js               shared book HTML + reader/print CSS + image credits
      epub.js               hand-rolled EPUB3 writer (images + credits page)
      pdf.js                PDF via Electron's print engine
      markdown.js           full-manuscript Markdown
    kindle/
      sendToKindle.js       SMTP delivery + verification (nodemailer)
  renderer/                 UI (vanilla JS, no build step)
    index.html, styles.css, app.js
test/                       node:test suite for the pure-logic modules
```

### The agentic writing pipeline
Modulagent treats book-writing as a small multi-agent workflow, leaning on each
CLI's agentic abilities (web search, long-context reasoning, tool use):

1. **Triage** — decides if the brief is clear or needs clarifying questions.
2. **Planner** — designs the title, premise, style guide and a concrete chapter
   outline (optionally research-grounded).
3. **Writer** — drafts each chapter in its own call, grounded by web research and
   the book's style guide, and only the *previous chapter's* compact continuity
   recap (so no single context must hold the whole book).
4. **Editor** — a second pass critiques and rewrites the draft to bestseller
   quality (toggleable).
5. **Illustrator** — sources high-resolution, openly-licensed images for any
   image markers and builds a credits page.
6. **Fallback chain** — every model call runs through the provider chain, so a
   quota/rate/auth/network failure transparently switches engines and keeps
   going. Progress is saved after every chapter, so a crash, cancel, or lapsed
   subscription always leaves a resumable draft.

### Privacy
Everything runs locally through your CLI on your subscription. Outbound network
happens only for: research web search (performed by the CLI), royalty-free image
lookups (Openverse), and the Send-to-Kindle email you trigger explicitly.

---

## 🧪 Tests

`npm test` runs the Node test suite (42 tests) covering JSON extraction, the
prompt library, the generation **and resume** pipeline (scripted fake engine),
error classification, image marker parsing/licensing, model config, the
subprocess runner (including env scrubbing), and EPUB/HTML/Markdown export. The
Electron-only modules are exercised by a headless boot smoke test.

## License

MIT
