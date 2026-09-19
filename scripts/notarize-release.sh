#!/usr/bin/env bash
# Recover notarization for already-signed artifacts. See SIGNING.md.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
DMG="release/ChapterOne-${VERSION}-mac-universal.dmg"
APP="release/mac-universal/ChapterOne.app"
ZIP="release/ChapterOne-${VERSION}-mac-universal.zip"
PROFILE="${1:-chapterone-notary}"

[ -f "$DMG" ] || { echo "Missing $DMG; build the signed universal app first."; exit 1; }
[ -d "$APP" ] || { echo "Missing $APP; keep the original app from this build."; exit 1; }
codesign --verify --deep --strict --verbose=2 "$APP"

echo "Submitting $DMG to Apple…"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait --timeout 30m
xcrun stapler staple "$DMG"
xcrun stapler staple "$APP"
xcrun stapler validate "$DMG"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"

# Recreate the ZIP so it contains the app's newly stapled ticket.
ZIP_TMP=$(mktemp -d)
trap 'rm -rf "$ZIP_TMP"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP_TMP/ChapterOne.zip"
mv "$ZIP_TMP/ChapterOne.zip" "$ZIP"
echo "Notarization verified; DMG and ZIP updated. Recalculate release checksums."
