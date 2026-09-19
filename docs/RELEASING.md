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
4. Configure signing as described in [SIGNING.md](../SIGNING.md). Use GitHub repository/environment secrets, not committed files.
5. Check the manual acceptance list below, then commit the reviewed release revision. The tag must point to that exact revision.

## Build and assemble

Push `v<package.json version>` to trigger the Release workflow. It:

1. Rejects a tag/package version mismatch.
2. Runs tests, syntax checks, dependency audit, and real Electron smoke checks.
3. Builds a universal Mac app and native x64/ARM64 Windows installers.
4. Requires macOS signing credentials for tagged builds, notarizes, and verifies the app. Optional Windows secrets enable Authenticode signing.
5. Tests packaged application code and uploads installers only when the build succeeds.
6. Waits for all platforms, checks that all four expected installers exist, calculates SHA256 checksums, and creates a **draft** GitHub release.

Manual workflow dispatch builds artifacts without creating a release; use it to rehearse signing. It still needs signing secrets for a signed rehearsal. A missing Mac certificate causes a tagged build to fail instead of silently producing an unsigned public candidate. If a draft already exists, inspect it before rerunning assembly: the workflow deliberately does not overwrite existing release assets.

Review `.github/RELEASE_NOTES.md`, replace the maintainer paragraph with version-specific changes and the exact Windows signing status, then publish the completed draft. Repository visibility is a separate owner action. Publishing a release in a private repository does not make it accessible to the public.

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
