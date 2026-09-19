# Working in this repository

ChapterOne is a vanilla CommonJS Electron writing app for macOS and Windows. Claude Code, Codex and Grok are invoked as external CLIs; Gemini uses a separately billed REST API. Libraries are local, but generation sends prompts and manuscript context to cloud providers. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the source map, flows and remaining limitations.

## Run and validate

Use Node.js 22.12+ (CI uses Node 22).

```bash
npm ci
npm start
npm run dev
npm run verify
npm run test:smoke
npm run dist:mac -- --publish never
npm run dist:win:x64 -- --publish never
npm run dist:win:arm64 -- --publish never
```

There is no renderer build step. Source/packaged Electron smoke tests use isolated temporary data and a scripted provider, never a paid account. Follow [SIGNING.md](SIGNING.md) and [docs/RELEASING.md](docs/RELEASING.md) for distribution.

## Implementation conventions

- Use two-space indentation, `'use strict'`, CommonJS, and focused modules. Explain constraints and reasons in comments.
- Keep the renderer dependency-light and build-step-free. `app.js` must remain wrapped in an IIFE because the preload's non-configurable `window.api` conflicts with a top-level `const api`.
- `preload.js` is the renderer's only Node bridge. Every IPC handler must use the trusted-sender wrapper and return `{ok:true,data}` or `{ok:false,error}`. `invoke(channel, ...args)` must forward all arguments.
- Settings defaults live in `store.js`. Preserve nested defaults and the safeStorage credential codec. Never log credentials or silently replace unreadable persisted settings with defaults.
- Persist chapter text before optional art. Coordinate writes through the IPC job guards so clear/delete/edit/export cannot corrupt an active generation.
- Generated prose must pass the shared HTML sanitizer. Generated SVG/HTML art must be sanitized and rasterized in the offline session with JavaScript disabled. Never embed raw model HTML or enable file/network subresources in offline renderers.
- The CLI restrictions and subscription environment scrub are security-sensitive. They do not override every possible user CLI configuration. Do not promise offline AI processing, guaranteed subscription billing, or copyright-free generated art.
- Windows npm `.cmd` shims need `spawn.js` command resolution; do not enable a general shell to run arbitrary CLI strings. Login commands use the quoting helper. Guard `osascript` and other platform-specific calls.
- EPUB `mimetype` must be first and uncompressed. PDF custom page sizes use **inches**. DOCX stream failures must reject.
- `marked` remains on its CommonJS-compatible v4 series. New runtime/native dependencies need a concrete reason; `sanitize-html` is the security boundary for prose HTML.
- Tests belong under `test/`. Use `npm run test:smoke` for modules requiring Electron (PDF/rasterization/IPC/UI); plain `node --test` cannot exercise those modules. Keep production retry delays while injecting an immediate delay for retry tests.
- New providers need catalog metadata, an adapter, factory/prerequisite wiring and tests. New exports need an exporter, IPC branch and reader control. Never use live paid requests as automatic test fixtures.

## Git / workflow

- Develop on the feature branch the session was given; commit with clear messages; push with `git push -u origin <branch>`. Do NOT open a PR unless asked. Do NOT put model identifiers in commit messages or code.
- Always run `npm test` (and a smoke test for UI/Electron changes) before committing.
