# Signing and notarization

The [Release workflow](.github/workflows/release.yml) builds a universal Mac DMG/ZIP and separate Windows x64/ARM64 NSIS installers. **All releases must be signed.** Mac releases also require Apple notarization; Windows releases require trusted Authenticode signatures and timestamps on both app executables and installers. There is no unsigned-release override.

A version tag publishes only after all build, signature, notarization, and uploaded SHA256 checks pass. Version 0.2.0 was withdrawn because it was unsigned; 0.2.1 is its pending signed replacement. Never republish the old unsigned draft or overwrite its binaries. See [RELEASING.md](docs/RELEASING.md).

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

`electron-builder.config.js` enables notarization when Apple credentials are present and uses `forceCodeSigning` for release builds. The Mac app is signed and notarized during packaging. The DMG container is separately signed, submitted to Apple, and stapled. The workflow verifies Developer ID signatures, the expected Apple team, Gatekeeper assessments, and stapled tickets for the app, DMG, and app extracted from the ZIP. A certificate's presence alone does not prove successful signing.

Missing or partial signing secrets fail before any release builds begin. The former `RELEASE_ALLOW_UNSIGNED` variable and `CHAPTERONE_ALLOW_UNSIGNED_RELEASE` flag are no longer honored. Do not use self-signed or ad-hoc signatures as substitutes for verified publisher signing.

Manual workflow dispatch on a branch rehearses signed builds without creating a release. Normal CI has signing disabled so pull requests never need private credentials; those artifacts are development tests and cannot be published by the release workflow.

## Local Mac builds

A Developer ID certificate in your login keychain can be detected automatically by electron-builder. Existing notarization credentials can remain in Keychain: set `APPLE_KEYCHAIN_PROFILE` to their profile name. The builder also supports securely configured Apple-ID or App Store Connect API-key credentials; see [the version-matched builder documentation](https://www.electron.build/v26/docs/mac/). For an unsigned development build only:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac -- --publish never
```

For recovery of an already-signed DMG after a transient notarization failure, store credentials once in Keychain (the password is prompted for):

```bash
xcrun notarytool store-credentials chapterone-notary \
  --apple-id you@example.com --team-id YOUR_TEAM_ID
bash scripts/notarize-release.sh
```

The helper reads the current package version, requires existing Developer ID signatures on the app and DMG, requires Apple's `Accepted` status, staples and validates both, then recreates and verifies the ZIP. An alternate credential profile can be passed as the first argument. It does not sign an unsigned application or DMG. If any verification fails, do not distribute those artifacts.

Test an actual downloaded, quarantined installer on a clean account. A locally built application opening successfully is insufficient evidence that Gatekeeper accepts a distributed build. Do not tell end users to disable security controls as the normal installation path.

## Windows signing

The current CI integration requires `WIN_CSC_LINK` (base64 `.pfx` certificate with private key) and `WIN_CSC_KEY_PASSWORD` for both architectures. The certificate must chain to a trusted code-signing authority. The workflow requires `Get-AuthenticodeSignature` status `Valid`, a timestamp certificate, and matching publishers on each installer and its packaged application executable.

Hardware-backed or hosted signing services need their own builder integration and runner authentication; do not export a non-exportable key or substitute a self-signed certificate. [Microsoft Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations) is one supported Windows service option, requiring an account, validated identity, and certificate profile. Choose the existing signing identity/service before adapting this workflow. Signing identifies the publisher but does not guarantee that reputation warnings disappear immediately.

## Before publishing

Follow the manual acceptance checks in [RELEASING.md](docs/RELEASING.md) and review the notes before pushing a version tag, which authorizes automatic publication. Verify that every installer plus `SHA256SUMS.txt` is present. Never reuse a published version for different binaries.
