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
git clone https://github.com/nimeshbuilds/chaperone.git
cd chaperone
npm ci
npm start          # launch the app
npm run dev        # launch with DevTools
npm run verify     # syntax, regression tests, and dependency audit
npm run test:smoke # real Electron app with synthetic provider data
```

Use **Node.js 22.12+** (Node 22 is used in CI). Automated tests require no AI accounts. For real generation, configure a supported Claude Code, Codex or Grok CLI, or a Gemini API key. Provider requests can consume subscription quota or incur charges.

## Project layout

See [the architecture guide](docs/ARCHITECTURE.md) for the module map and trust boundaries, and [CLAUDE.md](CLAUDE.md) for implementation conventions. Read [SECURITY.md](SECURITY.md) before changing IPC, generated markup, storage or CLI execution.

## Making a change

1. Create a branch off `main`.
2. Match the surrounding style: 2-space indent, `'use strict'`, small focused
   modules, JSDoc on exported functions. Comments explain *why*, not *what*.
3. Add or update a test under `test/` for any new pure-logic module or function.
4. Run `npm run verify` and, for UI/Electron changes, `npm run test:smoke`. Native CI must pass before merging.
5. Open a pull request with a clear description of the change and how you tested
   it. Reference any related issue.

## Pull request checklist

- [ ] `npm run verify` passes; relevant Electron smoke checks pass.
- [ ] No new runtime dependencies (or a clear justification).
- [ ] New behavior is covered by a test where practical.
- [ ] No secrets, API keys, or personal data committed.
- [ ] Commit messages are clear and describe *why*.

## Reporting bugs & ideas

Use the [issue templates](https://github.com/nimeshbuilds/chaperone/issues/new/choose).
For anything security-related, please follow [`SECURITY.md`](SECURITY.md) instead
of opening a public issue.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
