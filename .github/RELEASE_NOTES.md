ChapterOne {{VERSION}} includes the security, reliability, interface, and provider updates developed in the open-source readiness review. The repository lives at **nimeshbuilds/chapterone**.

This release replaces the withdrawn 0.2.0 release. The Mac downloads are Developer ID signed and notarized. See the platform signing status below before downloading the Windows installers.

## Downloads

| Download | Supported system |
| --- | --- |
| [Universal Mac DMG](https://github.com/{{REPOSITORY}}/releases/download/v{{VERSION}}/ChapterOne-{{VERSION}}-mac-universal.dmg) | macOS 13+, Intel and Apple Silicon; drag ChapterOne to Applications |
| [Universal Mac ZIP](https://github.com/{{REPOSITORY}}/releases/download/v{{VERSION}}/ChapterOne-{{VERSION}}-mac-universal.zip) | The same macOS app in a ZIP archive |
| [Windows x64 installer](https://github.com/{{REPOSITORY}}/releases/download/v{{VERSION}}/ChapterOne-{{VERSION}}-win-x64-setup.exe) | Windows 10/11, Intel or AMD 64-bit |
| [Windows ARM64 installer](https://github.com/{{REPOSITORY}}/releases/download/v{{VERSION}}/ChapterOne-{{VERSION}}-win-arm64-setup.exe) | Windows 11 on ARM64 |

**macOS signing:** {{MAC_SIGNING}}

**Windows signing:** {{WINDOWS_SIGNING}}

[SHA256SUMS.txt](https://github.com/{{REPOSITORY}}/releases/download/v{{VERSION}}/SHA256SUMS.txt) covers all four downloads. Check with `shasum -a 256 <file>` on macOS or `Get-FileHash <file> -Algorithm SHA256` in PowerShell. Checksums verify file integrity, not publisher identity.

## Changes

- Refreshed all supported provider catalogs: Claude Code, Codex, Gemini, Grok, Nano Banana image generation, and ElevenLabs narration. Added compatibility/retirement notes, kept saved model choices, and made custom-model checks explicit.
- Improved the full-window reader, library search/cards, smaller-window layouts, writing briefs, keyboard controls, accessible dialogs, and preserved drafts/settings during navigation.
- Hardened the Electron sandbox, IPC and file access, sanitized prose and illustrations, encrypted stored credentials, and updated vulnerable dependencies.
- Fixed interrupted-generation recovery, narration cache invalidation, Windows CLI execution, network streaming, export errors, and 6×9 print-PDF dimensions.
- Added native Windows x64/ARM64 installers alongside the universal Mac app, packaged UI checks, and automatic release publication after every required build and upload check passes.

See the [full changelog](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/CHANGELOG.md).

## Validation and limits

Built from commit [`{{COMMIT}}`](https://github.com/{{REPOSITORY}}/commit/{{COMMIT}}), with native builds and tests recorded in this [build run]({{BUILD_URL}}). Checks include unit tests, syntax checks, dependency audits, deliberate smoke-runner failure checks, and real Electron smoke tests against source and packaged app code. UI checks cover 12 workflow groups, synthetic generation, six export formats, print dimensions, and IPC isolation. Mac signing/notarization and uploaded asset sizes and SHA256 digests are verified before publication. Mac signing may be performed locally using the maintainer's Keychain; signing credentials are not included in downloads.

Automated checks use synthetic providers. Clean-machine install/upgrade/uninstall, every supported OS/hardware combination, real provider login/quotas, paid image/audio calls, SMTP delivery, and full screen-reader acceptance have **not** all been manually validated. See [release acceptance](https://github.com/{{REPOSITORY}}/blob/{{COMMIT}}/docs/RELEASING.md#manual-acceptance-before-public-launch).

Install a supported writing CLI or configure a Gemini API key in Settings. The desktop runtime is bundled; npm-based CLIs need a separate Node.js installation. Your library is local, but selected AI providers receive prompts and manuscript context; provider accounts and charges are separate. There is no automatic in-app updater; download this version to update.
