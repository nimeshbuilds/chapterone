# CLAUDE.md — Working in this repo

Guidance for any Claude session contributing to **ChapterOne — Your Personal
Book Writer** (by Modulagent). Read this first; it captures the architecture,
conventions, and the non-obvious gotchas that will save you time.

## What this is

A cross-platform **Electron** desktop app (macOS `.dmg` + Windows NSIS `.exe`)
that ghost-writes professional, bestseller-quality books by driving the user's
own AI **CLI** on their **subscription** — Claude Code (`claude`), Codex
(`codex`), or Gemini (`gemini`). It plans, researches, writes, edits, and
illustrates books (including a dedicated **Kids Books** flow with age bands);
reads them in a built-in EPUB reader; narrates them as **audiobooks**
(ElevenLabs, incl. voice cloning); exports EPUB/PDF/Markdown/MP3; and emails to
Kindle or any address (SMTP or macOS Mail.app hand-off).

There is **no server and no API keys for the writing** — it runs locally
through the user's CLI. Two opt-in features use keys the user supplies in
Settings, scoped to that feature only: Gemini image API (`nanoBanana.js`) for
photorealistic illustrations, and ElevenLabs (`elevenlabs.js`) for narration.
Other outbound network: the CLI's own web search, Openverse image lookups, and
emails the user explicitly sends.

## Run / test / build

```bash
npm install
npm start                 # launch the app
npm run dev               # launch with DevTools
npm test                  # node:test suite (fast, no Electron)
npm run dist:mac          # build .dmg   (also dist:win / dist:all)
```

There is **no renderer build step** — `src/renderer/` is plain HTML/CSS/JS
loaded directly. Keep it that way unless there's a strong reason.

## Architecture (where things live)

```
src/main/                 Electron MAIN process (Node)
  main.js                 app lifecycle, BrowserWindow, menu
  preload.js              contextBridge → window.api (the ONLY renderer↔main bridge)
  ipc.js                  ALL ipcMain handlers; wraps results as {ok,data}|{ok:false,error}
  store.js                JSON persistence: settings + books + images/exports dirs
  util.js                 safeFilename, etc.
  cli/
    spawn.js              child_process runner: stdin feed, abort, timeout, env scrub, enforceMinWords
    envPath.js            login-shell PATH reconstruction (Finder-launched apps get a bare PATH)
    models.js             provider catalog (PROVIDERS), model lists, npm packages, login metadata, scrub vars
    claudeAdapter.js      drives `claude -p` (web tools via --allowedTools)
    codexAdapter.js       drives `codex exec` (--search)
    geminiAdapter.js      drives `gemini -p`
    chainEngine.js        ChainEngine: ordered fallback across adapters
    authSession.js        AuthSessionManager: interactive login streaming + stdin
    index.js              buildAdapter / createEngine / createChainEngine / checkPrerequisites / installProviderCli
  book/
    prompts.js            ALL prompt text + SIZES + size helpers
    generator.js          the pipeline: clarify → outline → cover → chapters(+edit+art) → recap
    ageBands.js           kids age bands → vocabulary/length/safety/illustration density
    typography.js         book-grade text cleanup (quotes/dashes/markdown) + speech text
    json.js               extractJson (tolerant of fences/prose)
    errors.js             classifyError / isResumable / shouldFallback / describe
    images.js             Openverse stock-photo sourcing + marker resolution
    nanoBanana.js         OPT-IN Gemini image API illustrations (user-supplied key)
    elevenlabs.js         OPT-IN audiobook narration + voice cloning (user-supplied key)
    aiArt.js              SVG extract + sanitize + data-uri
  export/
    html.js               shared book HTML + reader/print CSS + cover/art figures
    epub.js               hand-rolled EPUB3 writer (images, AI art, cover, credits)
    pdf.js                PDF via offscreen BrowserWindow printToPDF (Electron-only)
    rasterize.js          SVG→PNG via offscreen BrowserWindow (Electron-only)
    markdown.js           full-manuscript Markdown
  kindle/
    sendToKindle.js       nodemailer SMTP + macOS Mail.app hand-off (composeInMail)
src/renderer/             UI (vanilla JS, no framework, no build)
  index.html, styles.css, app.js
test/                     node:test specs for the pure-logic modules
```

## The generation pipeline (book/generator.js)

`BookGenerator(engine)` where `engine` is a ChainEngine (or any adapter with
`.complete(prompt, opts)`):

1. `clarify(spec)` → asks clarifying questions if the brief is vague (JSON).
2. `generate(spec, answers, hooks)`:
   - `buildOutline` → title/premise/styleGuide/themes + chapters (JSON).
   - `_maybeCover` → AI SVG cover (if imageMode==='ai').
   - `_writeChapters` loop, per chapter: draft (streamed via `onStdout` →
     `chapter:stream`), optional **editor polish** pass, optional **AI chapter
     art** (SVG), then a compact **continuity recap** for the next chapter.
3. `resume(book, hooks)` continues a paused book from `book.chapters.length`.

Progress is emitted via `hooks.onProgress({phase, ...})` and the book is saved
after **every** chapter via `hooks.onChapter` — so cancel/crash/quota-loss
always leaves a resumable draft. On failure mid-chapter the book is marked
`status:'paused'` with `pausedReason` (see errors.js).

Key spec flags: `size` (small|medium|large), `research`, `polish`,
`imageMode` (off|ai|stock), `model`, `provider`.

## Non-obvious gotchas (read these)

- **Subscription, not API key.** Adapters strip `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `GEMINI_API_KEY` etc. from the child env (`spawn.js`
  `scrubEnv`, list in `models.js SUBSCRIPTION_SCRUB`) so the CLI uses the
  interactive login. Do NOT reintroduce API-key handling for the writing path.
  The login flow (`authSession.js`) deliberately does NOT scrub, so the CLI can
  write creds. The ONLY sanctioned key usage is the two opt-in feature keys the
  user enters in Settings (`nanoBanana.js` images, `elevenlabs.js` audio) —
  keep those scoped to their feature and never let them leak into the CLI env.
- **PATH is rebuilt via `envPath.js`.** A Finder/Dock-launched Electron app
  gets a bare PATH and won't find `claude`/`codex`/`gemini`/`npm`. Anything
  that spawns a CLI must go through the resolved PATH — don't spawn with the
  raw `process.env.PATH`.
- **Never accept stub chapters.** Adapters call `enforceMinWords` so a
  usage-limit one-liner ("usage limit reached") throws instead of being saved
  as a "chapter", which is what triggers chain fallback. Don't bypass it when
  adding a provider.
- **Renderer is wrapped in an IIFE.** `app.js` is `(function(){ const api =
  window.api; ... })()`. This is required: `contextBridge` exposes `api` as a
  non-configurable global, so a top-level `const api` would throw
  "already declared". Keep the IIFE.
- **No native dependencies.** Deps are `archiver`, `marked@^4` (CJS — do not
  bump to ESM v5+), `nodemailer`. The store is hand-rolled JSON (no
  electron-store). EPUB is hand-rolled (no epub-gen). Keep it dependency-light
  so packaging stays trivial.
- **SVG must be sanitized.** Any model-produced SVG goes through
  `aiArt.sanitizeSvg` (strips script/handlers/foreignObject/external refs)
  before it's embedded or rendered. Never embed raw model SVG.
- **The CLIs cannot generate raster images.** "AI art" = the CLI designs an
  **SVG**, which we then rasterize to PNG (`export/rasterize.js`). Don't promise
  DALL·E-style generation.
- **Electron-only modules:** `export/pdf.js`, `export/rasterize.js`, and the
  IPC/main glue need a running Electron app (BrowserWindow). They can't run
  under plain `node --test`. Test them via the headless smoke pattern below.
  Pure logic (prompts, json, errors, images selection, epub assembly, store,
  chain, adapters' arg-building) IS unit-tested.
- **`rasterize.js` reuses ONE offscreen window** for all images. Creating a new
  offscreen BrowserWindow per image fails after the first capture — don't
  refactor back to per-image windows.
- **EPUB zip:** `mimetype` must be the first entry and STORED (uncompressed).
  When grepping a built `.epub`, remember file *contents* are deflated — only
  filenames and the stored mimetype are visible in raw bytes; unzip to inspect
  the OPF.
- **IPC contract:** every `ipcMain.handle` returns `{ok:true,data}` or
  `{ok:false,error}` (see the `wrap` helper); `preload.js invoke()` unwraps it.
  Keep that shape.

## Testing

- `npm test` (node:test) for all pure logic. Add a spec under `test/` for any
  new pure module/function.
- For Electron behavior, use a headless smoke test:
  `xvfb-run -a node_modules/.bin/electron --no-sandbox <script>` where the
  script `require('src/main/main.js')`, waits for `ready`, and drives the
  renderer via `win.webContents.executeJavaScript(...)`. Capture
  `console-message` (level≥3) to catch renderer errors. `app.exit()` can
  truncate stdout — write results to a file and read it back, or add a short
  delay before exiting.

## Conventions

- Match surrounding style: 2-space indent, `'use strict'`, small focused
  modules, JSDoc on exported functions. Comments explain *why/constraints*, not
  *what*.
- Settings live in `store.defaultSettings()`. Adding a setting = add a default
  there, read it where needed, surface it in the engine bar or Settings in
  `app.js`. `deepMerge` preserves nested defaults.
- Adding a provider: add to `models.js PROVIDERS` + `SUBSCRIPTION_SCRUB`, create
  an adapter in `cli/`, wire it in `cli/index.js buildAdapter`, add it to
  `checkPrerequisites`, and the renderer picks it up from `getModels()`.
- Adding an export format: implement in `export/`, add a branch in the
  `book:export` IPC handler and a button in the reader.

## Git / workflow

- Develop on the feature branch the session was given; commit with clear
  messages; push with `git push -u origin <branch>`. Do NOT open a PR unless
  asked. Do NOT put model identifiers in commit messages or code.
- Always run `npm test` (and a smoke test for UI/Electron changes) before
  committing.
