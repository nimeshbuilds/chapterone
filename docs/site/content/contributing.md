## Get a development copy running

Use Node.js **22.12 or later**. CI uses Node 22. The app is CommonJS Electron with a vanilla HTML/CSS/JavaScript renderer and no renderer bundler.

```sh
git clone https://github.com/nimeshbuilds/chapterone.git
cd chapterone
npm ci
npm start
```

Use `npm run dev` for the development launch with DevTools. Read the repository's [contribution guide](https://github.com/nimeshbuilds/chapterone/blob/main/CONTRIBUTING.md), [coding conventions](https://github.com/nimeshbuilds/chapterone/blob/main/CLAUDE.md), and [security policy](https://github.com/nimeshbuilds/chapterone/blob/main/SECURITY.md) before changing a trust boundary.

## Know where a change belongs

The main process owns privileged operations, providers, persistence, and exports. The preload exposes a narrow bridge. The renderer owns user interaction and presentation. See the [architecture map](architecture.md) for module responsibilities and recovery behavior.

Keep runtime dependencies focused. Preserve the renderer's IIFE, trusted IPC wrappers, safe credential storage, shared HTML sanitizer, offline art/PDF rendering, and generation job guards. New providers need adapters, metadata, prerequisite checks, and tests; a new model catalog entry is not a new integration by itself.

## Run the right tests

```sh
npm run verify
npm run test:smoke
```

`verify` runs syntax checks, Node regression tests, and the locked dependency audit. The Electron smoke suite exercises the actual renderer, preload, IPC, synthetic generation, and exports. It uses isolated temporary data and a scripted provider; it does not consume paid AI credits.

Native CI covers Intel Mac, Apple Silicon, Windows x64, and Windows ARM64, with Linux unit tests. Packaged-code smoke runs catch missing files or differences in ASAR packaging. For a UI change, inspect screenshots and keyboard interaction as well as pass/fail output.

Automated coverage is not a claim that every real provider, hardware combination, clean installation, accessibility technology, or publisher workflow has been manually tested. Record those limits clearly in release notes.

## Work on this handbook

The handbook uses the existing Markdown and HTML-sanitizer dependencies. It loads no external fonts, analytics, or search service. Its page content is pre-rendered so navigation and reading work without JavaScript; local search and the compact mobile menu progressively enhance it.

```sh
node scripts/docs-build.cjs
node scripts/docs-build.cjs --check
```

The generated site is in `docs/site/dist/`. Preview it over HTTP from that directory; local search fetches a same-origin JSON index and therefore needs an HTTP server rather than `file://` browsing. For example, if Python is installed:

```sh
python3 -m http.server 4173 --directory docs/site/dist
```

Open `http://localhost:4173`. The site also works under the project's `/chapterone/` GitHub Pages path because internal assets and page links are relative.

Page order, titles, descriptions, and sources are configured in `docs/site/site.json`. Most source pages are in `docs/site/content/`. The model, architecture, and release reference pages are generated from their existing repository Markdown to avoid competing copies.

The build check validates internal pages, anchors, images, and assets; rejects unsafe local paths; and confirms search entries cover the guides. Add tests under `test/docs.test.js` when changing the builder's safety or link behavior. Run `node --test test/docs.test.js` for focused checks.

## Publish the handbook

`.github/workflows/pages.yml` builds and checks docs on relevant pushes and pull requests. Deployment runs only from `main`, uses the `github-pages` environment, and uploads only the generated site. Enable **Settings → Pages → Source → GitHub Actions** before deploying.

The intended project URL is [nimeshbuilds.github.io/chapterone](https://nimeshbuilds.github.io/chapterone/). Publication depends on repository Pages settings and GitHub plan eligibility; successful local generation alone does not mean the public site is deployed. See GitHub's [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Report and discuss changes

Describe the user problem, the resulting behavior, and how you tested it. Keep issue examples free of private manuscripts and credentials. Follow the [Code of Conduct](https://github.com/nimeshbuilds/chapterone/blob/main/CODE_OF_CONDUCT.md). Contributions are covered by the project's [MIT license](https://github.com/nimeshbuilds/chapterone/blob/main/LICENSE).
