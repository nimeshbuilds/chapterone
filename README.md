# BookWriter Studio ✒️

A cross-platform desktop app (macOS `.dmg` + Windows installer) that writes
**professional, bestseller-quality books on demand**. You describe the book you
wish existed; a "#1 bestselling author in that genre" plans it, writes it
chapter by chapter, and hands you a finished manuscript you can **read in the
app**, **export to Kindle (EPUB) / PDF / Markdown**, or **email straight to your
Kindle**.

It runs entirely on **your own AI subscription** by driving the CLI you already
use — the **Claude Code CLI** or the **Codex CLI** — locally. No API keys, no
third-party servers: your prompts and your books never leave your machine
(except the email you explicitly send to your own Kindle).

---

## ✨ What it does

- **Commission a book** — describe what you want to read. Vague is fine.
- **Smart clarification** — if the brief is ambiguous, the author asks 2–5
  sharp questions (with suggested answers) before writing.
- **Bestseller pipeline** — concept & title → full chapter outline →
  chapter-by-chapter prose that stays coherent via a rolling continuity recap.
- **Read in-app** — a clean, book-like reader.
- **Export** — EPUB (Kindle/KDP-ready), PDF, or Markdown.
- **Send to Kindle** — emails the EPUB/PDF to your `@kindle.com` address so it
  appears on your device, and gives you a KDP-ready EPUB to publish for others.
- **Configurable engine** — switch between Claude Code and Codex, pick models.
- **Prerequisite checks** — detects whether your chosen CLI is installed and
  authenticated, with a one-click connection test.

---

## 🔧 Prerequisites

You need **one** of the following installed and signed in:

| Engine | Install | Sign in |
| --- | --- | --- |
| **Claude Code** (default) | `npm i -g @anthropic-ai/claude-code` | run `claude` once and log in |
| **Codex** | install the OpenAI Codex CLI | run `codex` once and log in |

Plus **Node.js 18+** if you run from source. The app uses your existing
subscription via the CLI — it never asks for or stores API keys.

---

## 🚀 Run from source

```bash
npm install
npm start        # launch the app
npm run dev      # launch with DevTools
npm test         # run the unit/integration test suite
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
and notarized; see the electron-builder docs.

---

## 📨 Send to Kindle setup

Amazon delivers personal documents by email. In the app's **Settings → Send to
Kindle**, provide:

1. **Your Kindle address** — find it at *Amazon → Manage Your Content & Devices
   → Preferences → Personal Document Settings*. It looks like
   `yourname@kindle.com`.
2. **Approved sender** — add your sending email to Amazon's *Approved Personal
   Document E-mail List* on that same page, or Amazon will reject the message.
3. **SMTP credentials** — e.g. for Gmail use `smtp.gmail.com:587` with an
   [App Password](https://support.google.com/accounts/answer/185833). These are
   stored locally and used only to send from your own account.

Click **Verify SMTP** to test, then **📨 Send to Kindle** from any book.
EPUB is recommended (reflowable); PDF is also supported.

---

## 🏗️ Architecture

```
src/
  main/                     Electron main process (Node)
    main.js                 app lifecycle, window, menu
    preload.js              safe contextBridge API → renderer (window.api)
    ipc.js                  all IPC handlers (settings, generate, export, kindle)
    store.js                JSON persistence (settings + book library)
    cli/
      spawn.js              child-process runner (stdin feed, abort, timeout)
      claudeAdapter.js      drives `claude -p` headless
      codexAdapter.js       drives `codex exec` headless
      index.js              engine factory + prerequisite checks
    book/
      prompts.js            the "bestselling author" prompt library
      generator.js          clarify -> outline -> chapters pipeline
      json.js               robust JSON extraction from model output
    export/
      html.js               shared book HTML + reader/print CSS
      epub.js               hand-rolled EPUB3 writer (Kindle/KDP-ready)
      pdf.js                PDF via Electron's print engine
      markdown.js           full-manuscript Markdown
    kindle/
      sendToKindle.js       SMTP delivery + verification (nodemailer)
  renderer/                 UI (vanilla JS, no build step)
    index.html, styles.css, app.js
test/                       node:test suite for the pure-logic modules
```

### How generation stays coherent
Each chapter is written in its own CLI call (so no single context has to hold
the whole book). Before writing chapter *N*, the app sends a compact 3–4
sentence **continuity recap** of chapter *N−1* plus the book's style guide,
premise, and the planned beats. Progress is **saved after every chapter**, so a
crash or cancel still leaves a readable partial draft.

### Privacy
Everything runs locally through your CLI. The only outbound network action is
the **Send to Kindle** email, which you trigger explicitly and which goes
through *your* SMTP account to *your* Kindle address.

---

## 🧪 Tests

`npm test` runs the Node test suite covering JSON extraction, the prompt
library, the generation pipeline (with a scripted fake engine), EPUB/HTML/
Markdown export, and the settings/library store. The Electron-only modules
(`main`, `ipc`, `pdf`) are exercised by a headless boot smoke test.

## License

MIT
