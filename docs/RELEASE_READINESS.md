# Open-source release readiness

Assessment of the 0.2.0 candidate prepared on the `release-readiness` branch in September 2026. This is an engineering assessment of the code and distribution, not a claim that every historical Mac or Windows computer is supported.

## Decision

The repository has the core product features for an initial open-source release: planning/review, resumable writing, editing, reading, illustration, narration and six export formats. The main gaps were security, data reliability, accurate privacy/billing information, and a release process that produced Windows installers. Those are addressed in this branch.

**Public launch still needs signing credentials, the manual acceptance checks, and the owner's visibility decision.** The unsigned 0.2.0 release was withdrawn. Its 0.2.1 replacement requires signed/notarized Mac downloads and signed Windows installers before publication. Publishing a release does not change repository visibility. CI artifacts remain separate unsigned test builds.

## Scope and architecture

The [architecture guide](ARCHITECTURE.md) maps the main process, renderer, every CLI adapter, generation/prompts, art/audio, persistence, export and delivery modules. Review also covered dependencies, packaging assets/configuration, tests, workflows, licenses and contributor/security documentation.

The app is deliberately small: CommonJS main-process modules, a vanilla JavaScript renderer, JSON storage, and external AI providers. There is no application backend. Local storage does not mean offline inference; manuscript context and optional media are sent to configured services.

## Release-blocking defects addressed

| Finding | Change and validation |
| --- | --- |
| Obsolete runtime/build dependencies; full initial audit reported 14 vulnerable packages, including one critical | Electron/build tooling and runtime dependencies updated; full lockfile audit now included in CI |
| Model-authored HTML and permissive desktop boundaries could expose privileged functions | Shared prose sanitizer, strict document policy, renderer sandbox, sender/frame validation and restricted file/navigation/permission handling; regression and Electron smoke coverage |
| Offline art/PDF rendering could read arbitrary local resources | Isolated sessions allow only the intended document and inline resources; JavaScript disabled |
| API/SMTP secrets and their backup were plaintext; clearing could leave credentials behind | OS-encrypted secrets, migration of both settings copies, validated backup recovery and complete app-data clearing |
| Concurrent writes and optional-art failures could lose saved prose | Write guards and earlier chapter checkpoints; cover/review failure persists a resumable draft |
| Narration cache ignored edited text and duplicate requests could incur duplicate charges | Content/voice/model-based cache keys and in-flight deduplication |
| Print PDF passed microns to an API expecting inches | Six-by-nine dimensions checked in actual exported PDFs |
| CLI nonzero exits/Windows command paths and provider stream failures were insufficiently handled | Adapter, quoting, npm-shim, native PATH, UTF-8 and stream truncation regressions |
| Connection checks could spend image/text credits | Metadata GET requests for Gemini/Nano Banana, with explicit inconclusive model-alias results |
| Windows packages were advertised but missing from releases | Native x64/ARM64 builds and packaged smoke tests; all-platform publication with uploaded SHA256 verification and explicit signing status |
| Reader controls were squeezed beside the sidebar; briefs were lost on navigation; dialogs lacked keyboard handling | Responsive reader/library/forms, preserved briefs, native modal dialogs, keyboard controls, and 12 real-UI interaction groups; see [UI testing](UI_TESTING.md) |
| Presets used retired subscription models and opening saved custom models could trigger billed probes | September 2026 [model catalog](MODELS.md), retirement notices, explicit checks, preserved settings, media request compatibility tests and real-UI coverage |
| Documentation implied offline AI, retired Gemini login, free art and print-platform compliance | README, security guide, setup UI and release notes corrected |

## Automated evidence

- Local source and packaged Electron smoke runs exercise the real UI/preload/IPC, synthetic generation, EPUB/DOCX/HTML/Markdown/PDF/print-PDF, rasterization and rejected untrusted IPC/file opening.
- The initial dependency audit had 14 findings; the updated full dependency tree has zero findings as of this review. This is time-specific, not a promise about future advisories.
- Gitleaks scanned all 81 original commits and reported no exposed secrets. Tests use synthetic keys; no credentials were added during the work.
- Installer builds completed on all four architectures. Reviewing the Windows logs uncovered a falsely successful Electron exit after a PDF path-normalization error. The path check now uses canonical local file identity, and the smoke runner requires an explicit completion record as well as a zero exit code. See the [branch’s latest CI runs](https://github.com/nimeshbuilds/chaperone/actions/workflows/ci.yml?query=branch%3Arelease-readiness) for the corrected source/packaged checks; validate the exact revision before tagging.
- GitHub Actions workflows are checked with actionlint. Unit retries use injected delays, cutting the suite from minutes to seconds without disabling production backoff.

Native CI proves that source and packaged application code runs on those hosted environments. It does **not** prove clean-machine installer UX, Windows 10 compatibility on physical hardware, every GPU/display setup, live provider subscriptions, signing, or upgrade behavior.

## Before making the project public

1. Supply the Apple signing/notarization secrets described in [SIGNING.md](../SIGNING.md). None were configured in repository Actions secrets at review time. Choose and disclose Windows signing status; unsigned builds can still trigger publisher warnings.
2. Complete [manual acceptance](RELEASING.md#manual-acceptance-before-public-launch), especially real CLI login, one small book, paid-feature consent, Mac automation/microphone permissions, upgrade safety and install/uninstall on both Windows architectures.
3. Confirm third-party account/model availability and realistic quota/cost descriptions with actual authorized accounts. The review did not generate paid books, send mail, upload voice samples or change provider accounts.
4. Add a private conduct-reporting contact, enable private security reporting and secret scanning/push protection, and require passing native CI before merge. MIT license, contributing guide, conduct policy and issue templates are already present.
5. Merge the reviewed branch and complete the acceptance checks. For signed distribution, prepare a new version and use the signed release pipeline; do not replace published unsigned binaries. Review all assets/checksums and release notes before choosing public repository visibility.

## Missing features: priority and rationale

| Priority | Feature | Why / recommended scope |
| --- | --- | --- |
| Next | Portable library backup and restore | Export books/media plus a manifest, validate imports and preserve IDs safely. Exclude API keys; OS-encrypted settings cannot migrate between accounts. Current manuscript exports are not a library backup. |
| Next | Assistive-technology acceptance | Keyboard/dialog/reader/reduced-motion fixes are covered by UI automation. VoiceOver/NVDA, full contrast review, high-contrast mode and 200% zoom still need hands-on validation. See [coverage and limits](UI_TESTING.md). |
| Next | Redacted diagnostics and provider compatibility checks | Make CLI path/version and recoverable error reporting understandable without exposing prompts, keys or user paths. Keep reporting opt-in and previewable. |
| Later | Better generation checkpoints and usage estimates | Completed prose survives, but cancelled art/research work can still be repeated. Persist optional-work checkpoints and clarify per-provider cost estimates. |
| Later | Signed update delivery | There is no auto-updater; users currently download releases manually. Add updates only after signing, channels and rollback behavior are established. |
| Later | Rich DOCX/print production | DOCX currently exports manuscript text; layout, embedded art, bleed, margins and publishing-platform validation need a separate production-focused feature. |
| Later | Automated independent export validation | Add EPUBCheck and document-reader fixtures to strengthen interoperability beyond ZIP/XML and runtime export checks. |

These are product improvements, not prerequisites to claim basic book drafting/export support. Do not postpone dependency/security maintenance to add more AI providers or visual effects.
