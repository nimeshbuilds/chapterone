# Signing & notarizing ChapterOne (no more Gatekeeper warning)

macOS shows *"Apple could not verify ChapterOne is free of malware…"* for any app
that is **not notarized**. The only way to remove it for downloaded apps is to
sign the app with an **Apple Developer ID** certificate and **notarize** it with
Apple. This is already wired into the build (`electron-builder.config.js`); it
turns on automatically once the credentials below are present, and stays off
(unsigned, as today) otherwise.

## One-time setup

1. **Enroll** in the Apple Developer Program — https://developer.apple.com/programs/ ($99/year).

2. **Create a "Developer ID Application" certificate** and install it in your
   login keychain. Easiest path: Xcode → Settings → Accounts → your Apple ID →
   *Manage Certificates…* → **+** → **Developer ID Application**. (Or create it at
   https://developer.apple.com/account/resources/certificates and double-click to
   install.) Verify it's there:
   ```bash
   security find-identity -v -p codesigning   # should list "Developer ID Application: …"
   ```

3. **Create an app-specific password** for notarization at
   https://appleid.apple.com → Sign-In and Security → *App-Specific Passwords*.

4. **Find your Team ID** at https://developer.apple.com/account → Membership
   (a 10-character string like `AB12CD34EF`).

## Building a signed + notarized DMG

Export the three env vars, then build as usual:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"   # the app-specific password
export APPLE_TEAM_ID="AB12CD34EF"

npm run dist:mac
```

What happens automatically:
- electron-builder finds your **Developer ID Application** cert and signs the app
  (hardened runtime + entitlements are already configured in
  `build/entitlements.mac.plist`).
- It then **notarizes** with Apple's `notarytool` (a quick automated malware scan,
  usually 1–5 minutes) and **staples** the ticket to the DMG.

Result: users download the DMG, double-click, drag to Applications, and it opens
with **no warning**.

## Verify it worked

```bash
# after building, mount the DMG / point at the .app
spctl -a -vvv "/Applications/ChapterOne.app"        # → "accepted, source=Notarized Developer ID"
codesign -dv --verbose=4 "/Applications/ChapterOne.app"  # → Authority=Developer ID Application: …
xcrun stapler validate "release/ChapterOne-0.1.0-universal.dmg"  # → "The validate action worked!"
```

## Notes
- Until you enroll, nothing changes — the build stays unsigned and testers use
  one-time `right-click → Open` (or `xattr -dr com.apple.quarantine
  "/Applications/ChapterOne.app"`).
- For CI, you can instead provide the cert as `CSC_LINK` (base64 `.p12`) +
  `CSC_KEY_PASSWORD`, and an App Store Connect API key via `APPLE_API_KEY` /
  `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` instead of the Apple ID password.
- **Windows** has the equivalent (SmartScreen): it needs an Authenticode / EV
  code-signing certificate to avoid the "unknown publisher" warning.
