# Signing and notarization

The [Release workflow](.github/workflows/release.yml) builds a universal Mac DMG/ZIP and separate Windows x64/ARM64 NSIS installers. A version tag **publishes** the release after all platform checks pass and all uploaded assets match their expected sizes and SHA256 digests. See [RELEASING.md](docs/RELEASING.md) for the complete procedure.

## macOS signing in GitHub Actions

Use an Apple **Developer ID Application** certificate with its private key, exported from Keychain Access as a password-protected `.p12`. Add the following repository Actions secrets:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded `.p12` contents (electron-builder `CSC_LINK`) |
| `MAC_CSC_KEY_PASSWORD` | Password protecting the exported certificate |
| `APPLE_ID` | Apple account authorized for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that account |
| `APPLE_TEAM_ID` | Developer team identifier |

Do not commit certificates, passwords, or exported environment files. Use the GitHub secrets UI or `gh secret set` interactively; avoid credentials in shell history. The workflow supplies Mac credentials only to the Mac builder. See [electron-builder's signing guide](https://www.electron.build/code-signing-mac.html) and [Apple's notarization documentation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

`electron-builder.config.js` enables notarization when the Apple credentials are present. The workflow verifies the app signature, Gatekeeper assessment, and stapled tickets before assembling a signed release. A certificate's presence alone does not prove successful signing.

Without Apple secrets, releases fail unless a maintainer explicitly sets the repository Actions variable **`RELEASE_ALLOW_UNSIGNED=true`**. That opt-in disables certificate discovery, permits an unsigned Mac release, and generates release notes stating that the app is unsigned and not notarized. Gatekeeper may block launch. Partial Apple or Windows signing configuration always fails; the workflow never silently downgrades a failed signing attempt. Remove the variable when signed distribution becomes required. Version 0.2.0 uses this unsigned release option.

Manual workflow dispatch on a branch rehearses the configured build policy without creating a release. Normal CI has signing disabled and produces test artifacts only.

## Local Mac builds

A Developer ID certificate in your login keychain can be detected automatically by electron-builder. Apple notarization credentials can be supplied through a securely configured environment. For an unsigned development build:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- --publish never
```

For recovery of an already-signed DMG after a transient notarization failure, store credentials once in Keychain (the password is prompted for):

```bash
xcrun notarytool store-credentials chapterone-notary \
  --apple-id you@example.com --team-id YOUR_TEAM_ID
bash scripts/notarize-release.sh
```

The helper reads the current package version, submits the existing DMG, staples and validates both the DMG and app, then recreates the ZIP from the stapled app. An alternate credential profile can be passed as the first argument. It does not sign an unsigned application. If any verification fails, do not distribute those artifacts.

Test an actual downloaded, quarantined installer on a clean account. A locally built application opening successfully is insufficient evidence that Gatekeeper accepts a distributed build. Do not tell end users to disable security controls as the normal installation path.

## Windows signing

Add `WIN_CSC_LINK` (base64 `.pfx` certificate with private key) and `WIN_CSC_KEY_PASSWORD` to enable electron-builder Authenticode signing for both architectures. The workflow validates installer signatures when a certificate is configured. Hardware-backed or hosted signing services require their own builder integration; a certificate that cannot be exported is not interchangeable with a `.pfx` secret.

Windows packages can be built without these secrets. The workflow then labels them **unsigned** in the release notes; users may see an unknown-publisher/SmartScreen warning. Signing identifies the publisher but does not guarantee that all reputation warnings disappear immediately.

## Before publishing

Follow the manual acceptance checks in [RELEASING.md](docs/RELEASING.md) and review the notes before pushing a version tag, which authorizes automatic publication. Verify that every installer plus `SHA256SUMS.txt` is present. Never reuse a published version for different binaries.
