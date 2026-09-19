# Release procedure

## Supported distribution

| Asset | Minimum target |
| --- | --- |
| Universal macOS DMG and ZIP | macOS 13; Intel x64 and Apple Silicon ARM64 |
| Windows x64 NSIS installer | Windows 10/11 x64 |
| Windows ARM64 NSIS installer | Windows 11 ARM64 |

Electron 44 sets the macOS 13 floor. Supporting older OS releases would require a separate, actively maintained runtime branch. Do not describe this as support for every historical Mac or Windows PC.

## Prepare a version

1. Review the change and update `CHANGELOG.md`. Use `npm version <version> --no-git-tag-version` so package and lock versions agree.
2. Run `npm ci`, `npm run verify`, and `npm run test:smoke`. Let CI complete on all four desktop targets.
3. Read the artifact's platform name carefully. CI provides unsigned test installers; a passing unit test job alone is not evidence that an installer built.
4. Configure mandatory Apple signing/notarization and Windows signing as described in [SIGNING.md](../SIGNING.md). An owner-approved, exact-version exception may permit unsigned Windows installers; it never permits unsigned Macs or partial signing credentials. Use GitHub secrets, not committed files, for certificates/passwords.
5. Check the manual acceptance list below, then commit the reviewed release revision. The tag must point to that exact revision.

## Build and assemble

Push `v<package.json version>` to trigger the Release workflow. It:

1. Rejects a tag/package version mismatch.
2. Runs tests, syntax checks, dependency audit, and real Electron smoke checks.
3. Builds a universal Mac app and native x64/ARM64 Windows installers.
4. Requires Developer ID signing and notarization for the Mac app and DMG, verifies Gatekeeper/stapled tickets including the app extracted from the ZIP, and requires valid timestamped Authenticode signatures for Windows installers and their app executables unless the exact-version unsigned Windows exception applies. The unsigned path verifies `NotSigned` status and discloses it in release notes.
5. Tests packaged application code and uploads installers only when the build succeeds.
6. Waits for all platforms, checks all four expected installers, calculates SHA256 checksums, and generates version-specific notes with the selected signing status and exact source/build links.
7. Uploads every installer and checksum to a temporary draft, verifies their GitHub sizes and SHA256 digests, and **publishes** the complete release. Stable version tags become Latest; tags containing a prerelease suffix become prereleases.

Manual workflow dispatch on a branch builds signed artifacts without creating a release; use it to rehearse signing. Dispatch on an existing version tag follows the same publication path as pushing that tag. If a draft already exists after a failed upload, inspect its assets before recovery: the workflow deliberately does not overwrite them or reuse a published release. Version 0.2.0 was withdrawn because it was unsigned; never republish that draft or replace its binaries. Use version 0.2.1 for the replacement: the owner approved unsigned Windows installers for this version, while the Mac downloads still require signing and notarization.

When Mac signing uses a local Keychain, follow the [manual assembly procedure](../SIGNING.md#assemble-with-a-local-mac-signing-identity) with Windows CI artifacts from the same commit. Record the verification results and use the exact `RELEASE_MANUAL_TAG` to avoid a duplicate automatic build.

Review `.github/RELEASE_NOTES.md` before tagging; the script fills its version, signing and provenance fields. Pushing a version tag authorizes publication once every check passes. Repository visibility is a separate owner action. Publishing a release in a private repository does not make it accessible to the public.

## Manual acceptance before public launch

- Install from the downloaded DMG on Intel and Apple Silicon, and from each EXE on matching Windows hardware. Include a non-ASCII username and paths containing spaces.
- Verify the Mac Developer ID signature and notarization on a quarantined download, not only a local build. Check Windows publisher/signature status and document SmartScreen behavior.
- Upgrade from the previous app while preserving books and settings; uninstall/reinstall and verify the documented data behavior.
- On a clean machine, install one CLI via Settings and complete terminal/browser login. Also check Gemini API-key setup. Test current supported provider versions without developer environment variables.
- Write a short book with a real provider; approve an outline, pause during writing, quit/reopen, resume, edit/rewrite, read and export. Check subscription-limit fallback with providers you have authorized.
- Test one illustration and narration request on an account with a known budget. Confirm billing prompts, voice consent, microphone permissions, and changed-chapter cache invalidation.
- Open EPUB in an independent reader, DOCX in Word/LibreOffice, HTML in a browser, and PDFs in Preview/Edge. Confirm 6×9 page dimensions and visually review the print layout.
- Test SMTP only with your own recipient. Verify macOS Mail hand-off and Windows saved-file hand-off separately.
- Check keyboard-only use, screen-reader labels, zoom/high-DPI scaling and reduced-motion settings. Record remaining accessibility limitations.
- Enable GitHub private vulnerability reporting, secret scanning/push protection, branch protection and required CI checks before making the repository public. Confirm a private contact route for conduct reports.

These are release acceptance checks, not claims already established by the automated smoke suite. The smoke suite uses synthetic text, does not spend AI credits, and does not install or uninstall the application on a clean OS.

## Download integrity

`SHA256SUMS.txt` contains exactly the four installer names. On macOS use `shasum -a 256 -c SHA256SUMS.txt` with all files present. In PowerShell, use `Get-FileHash <installer> -Algorithm SHA256` and compare its hash with the matching line. Checksums detect changed files; code signatures establish publisher identity.

## Maintenance

Keep Electron within an upstream-supported release series. Review Dependabot changes and the full dependency audit; Electron is a devDependency in npm but is the shipped browser/runtime. Repeat native builds for runtime updates. Keep CLI adapter compatibility and provider model lists current independently of app packaging. Do not reuse a published version/tag for changed binaries.
