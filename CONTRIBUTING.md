# Contributing to ChapterOne

Thanks for your interest in improving ChapterOne! This is a small,
dependency-light Electron app, and contributions of all sizes are welcome.

## Ground rules

- Be kind and constructive — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Open an issue before a large change so we can agree on the approach.
- Keep the project **dependency-light** and **build-step-free** on the renderer.
  New runtime dependencies and native modules need a strong justification.

## Getting started

```bash
git clone https://github.com/npandeya/bookwriter.git
cd bookwriter
npm install
npm start          # launch the app
npm run dev        # launch with DevTools
npm test           # run the test suite (must pass before you push)
```

You'll need **Node.js 18+** and at least one AI CLI (Claude Code, Codex, or
Gemini) installed and signed in to exercise the generation flow.

## Project layout

See [`README.md`](README.md#architecture) for the high-level map and
[`CLAUDE.md`](CLAUDE.md) for a detailed architecture guide, conventions, and the
non-obvious gotchas (subscription-not-API-key, the renderer IIFE, SVG
sanitization, EPUB packaging, etc.). Reading `CLAUDE.md` will save you time.

## Making a change

1. Create a branch off `main`.
2. Match the surrounding style: 2-space indent, `'use strict'`, small focused
   modules, JSDoc on exported functions. Comments explain *why*, not *what*.
3. Add or update a test under `test/` for any new pure-logic module or function.
4. Run `npm test` (and, for UI/Electron changes, a quick manual smoke run).
5. Open a pull request with a clear description of the change and how you tested
   it. Reference any related issue.

## Pull request checklist

- [ ] `npm test` passes.
- [ ] No new runtime dependencies (or a clear justification).
- [ ] New behavior is covered by a test where practical.
- [ ] No secrets, API keys, or personal data committed.
- [ ] Commit messages are clear and describe *why*.

## Reporting bugs & ideas

Use the [issue templates](https://github.com/npandeya/bookwriter/issues/new/choose).
For anything security-related, please follow [`SECURITY.md`](SECURITY.md) instead
of opening a public issue.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
