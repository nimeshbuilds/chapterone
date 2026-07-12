#!/usr/bin/env bash
#
# Notarize + staple the ALREADY-BUILT, already-signed release artifacts, without
# rebuilding. Use this after `npm run dist:mac` when notarization was skipped or
# failed transiently (e.g. an expired Apple Developer agreement you have since
# re-signed at https://developer.apple.com/account → Agreements).
#
# Prereq: a stored notary credential profile named "chapterone-notary":
#   xcrun notarytool store-credentials chapterone-notary \
#     --apple-id "<your-apple-id>" --team-id QPF2VF2885 --password "<app-specific-pw>"
#
set -euo pipefail

DMG="release/ChapterOne-0.1.0-universal.dmg"
APP="release/mac-universal/ChapterOne.app"
PROFILE="chapterone-notary"

[ -f "$DMG" ] || { echo "No DMG at $DMG — run 'npm run dist:mac' first."; exit 1; }

echo "→ Submitting $DMG to Apple notary service (this can take a few minutes)…"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait --timeout 30m

echo "→ Stapling the ticket to the DMG and app…"
xcrun stapler staple "$DMG"
[ -d "$APP" ] && xcrun stapler staple "$APP" || true

echo "→ Verifying Gatekeeper acceptance…"
xcrun stapler validate "$DMG"
[ -d "$APP" ] && spctl --assess --type execute -vv "$APP" || true

echo "✅ Notarized + stapled. The DMG is ready to distribute."
