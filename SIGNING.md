# Signing & notarizing ChapterOne

macOS shows *"Apple could not verify ChapterOne is free of malware…"* for any app
that is **not notarized**. Removing that warning for downloaded apps requires
signing with an **Apple Developer ID** certificate and **notarizing** with Apple.

Signing is done **manually / locally** for now (there is no CI signing workflow).
The steps below are exactly what produces the published `v0.1.0` DMG.

## One-time setup

1. **Enroll** in the Apple Developer Program — https://developer.apple.com/programs/ ($99/year).

2. **Create a "Developer ID Application" certificate** and install it in your
   login keychain. Easiest path: **Xcode → Settings → Accounts →** your Apple ID
   **→ Manage Certificates… → ＋ → Developer ID Application.** Verify:
   ```bash
   security find-identity -v -p codesigning   # → "Developer ID Application: Your Name (TEAMID)"
   ```
   The 10-character code in parentheses is your **Team ID**.

3. **Create an app-specific password** for notarization at
   https://appleid.apple.com → Sign-In and Security → *App-Specific Passwords*.

4. **Store the notarization credentials in your keychain once**, so the password
   never sits in your shell history or environment:
   ```bash
   xcrun notarytool store-credentials "chapterone-notary" \
     --apple-id "you@example.com" \
     --team-id "ABCDE12345"
   # paste the app-specific password when prompted → "This profile is ready to use."
   ```

## Build → notarize → staple

electron-builder **signs** the app during the build (it auto-detects the
Developer ID cert; hardened runtime + entitlements are already configured in
`build/entitlements.mac.plist`). Then notarize and staple manually:

```bash
npm run dist:mac                                                   # build + sign the universal DMG

xcrun notarytool submit release/ChapterOne-0.1.0-universal.dmg \
  --keychain-profile "chapterone-notary" --wait                   # ~2–15 min; wait for "status: Accepted"

xcrun stapler staple release/ChapterOne-0.1.0-universal.dmg        # attach the ticket to the DMG
xcrun stapler staple release/mac-universal/ChapterOne.app          # and to the app (offline-robust)
```

> If `--wait` times out on Apple's status endpoint, the submission is still
> processing — re-check with `xcrun notarytool info <id> --keychain-profile chapterone-notary`.

## Verify

```bash
spctl --assess --type execute -vv "/Applications/ChapterOne.app"        # → accepted, source=Notarized Developer ID
codesign -dv --verbose=4 "/Applications/ChapterOne.app"                 # → Authority=Developer ID Application: …
xcrun stapler validate "release/ChapterOne-0.1.0-universal.dmg"         # → The validate action worked!
```

A locally-built app is not quarantined, so it opens without a warning even before
notarization. The notarization + staple is what makes the **downloaded** DMG open
cleanly for everyone.

## Publish the release

```bash
gh release create v0.1.0 \
  --title "ChapterOne v0.1.0" --notes-file notes.md \
  release/ChapterOne-0.1.0-universal.dmg
```

## Automating in CI later (optional)

Not set up today. If you want GitHub Actions (macOS runner) to build, sign,
notarize, and publish on a `v*` tag, you'd:

- export the Developer ID cert from Keychain Access as a base64 `.p12` and add
  repo secrets `CSC_LINK` + `CSC_KEY_PASSWORD`, plus `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`;
- `electron-builder.config.js` already auto-notarizes when those Apple env vars
  are present, so the workflow is just `npm run dist:mac` + publish.

## Notes

- **Unsigned builds** (no cert): testers open with a one-time `right-click → Open`,
  or clear the quarantine flag: `xattr -dr com.apple.quarantine "/Applications/ChapterOne.app"`.
- **Windows** has the equivalent (SmartScreen "unknown publisher"); it needs an
  Authenticode / EV code-signing certificate, which this project does not have yet.
