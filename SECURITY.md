# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/npandeya/bookwriter/security/advisories/new). Do not include credentials or private manuscripts in a public issue. Include the app version, operating system, steps to reproduce, and expected impact. Maintainers must enable private reporting before public launch.

Security fixes target the latest released version. The old 0.1.x runtime and dependencies should not be used as the basis of new distributions. No response-time SLA is promised.

## Data and network behavior

ChapterOne has no application backend, analytics SDK or automatic crash upload. Your library is stored on your computer, but AI generation is **not offline**:

- Claude Code, Codex and Grok send prompts and manuscript context to their respective services. Research additionally uses their web tools.
- Gemini text generation uses Google's REST API with your key. This is separate from Gemini CLI, which still supports Google login.
- Nano Banana sends illustration prompts and selected character reference photos to Google's image service.
- ElevenLabs receives narration text and, when explicitly requested, voice-cloning samples. Voice cloning requires the user's consent in the app.
- SMTP delivery sends the selected manuscript to your configured mail server and recipient. macOS Mail hand-off creates a draft; on Windows the saved file is revealed for manual attachment.
- Installing a CLI downloads software from npm. Legacy stock-image books may retain Openverse source links.

Providers have their own billing, retention and account policies. Automatic fallback can send a request to the next provider in the configured chain. Removing the local copy does not delete provider-side data. Never describe AI illustrations as guaranteed copyright-free or every provider request as free.

## Local storage and secrets

Books, character photos, exports and audio are unencrypted local files. Protect the OS account and use device encryption where needed. Settings credentials (Gemini text/image keys, ElevenLabs key, SMTP password) are encrypted with Electron `safeStorage`: macOS Keychain or Windows DPAPI. They are decrypted in the running app and settings UI. This protects the stored value; it does not protect against software already controlling your account or a compromised main process.

The app migrates existing plaintext settings and their backup when secure OS storage is available. It refuses credential persistence if secure storage is unavailable, and refuses to silently reset unreadable existing settings. Copied encrypted settings cannot serve as a portable credential backup for another OS account. Old OS backups may retain prior plaintext settings.

Settings and books use atomic replacement; the last readable settings snapshot is retained as a backup. **Clear all my data** removes app-managed books, media, exports, settings, settings backups and renderer preferences. It does not remove files exported elsewhere, CLI login credentials, OS backups, or remote data. Deleting one book removes its associated image/audio folders and leaves independent exports intact.

## Desktop boundaries

- The main window has context isolation and Chromium sandboxing. Node APIs are exposed only through a narrow preload bridge.
- Privileged IPC rejects callers other than the application's top-level document. Navigation, child windows, permissions and file-opening paths are restricted.
- Markdown is sanitized before becoming reader/export HTML. A content security policy blocks scripts and remote loads in generated standalone documents.
- Generated illustration markup is sanitized and rasterized with JavaScript disabled in an isolated session that rejects network and embedded local-file requests. PDF rendering has a separate offline session.
- CLI arguments disable shell/editing tools and constrain research where supported. Known API-key environment variables are stripped when subscription mode is enabled. User-installed CLIs and their configuration remain part of the trust boundary; this is not a complete OS filesystem/network sandbox or a guarantee of subscription billing.
- Destructive library operations are blocked while generation/export/narration is writing. Audio cache keys include manuscript content and voice settings.

AI/provider output remains untrusted content. Security boundaries are regression-tested, but generated books still need human factual, suitability and rights review before sharing or publication.

## Dependencies and release integrity

`npm run verify` audits the entire dependency tree, including Electron and build tooling. High/critical findings fail CI. Native jobs build and smoke-test Intel/Apple Silicon Mac and x64/ARM64 Windows packages. Tagged Mac releases require signing/notarization; Windows signing is configured separately. The release workflow assembles a draft only after all targets pass and includes SHA256 checksums. See [SIGNING.md](SIGNING.md) and [release procedure](docs/RELEASING.md).
