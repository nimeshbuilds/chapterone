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
codesign --verify --strict --verbose=2 "$DMG"
for target in "$APP" "$DMG"; do
  signature=$(codesign --display --verbose=2 "$target" 2>&1)
  [[ "$signature" == *'Authority=Developer ID Application:'* ]] || { echo "Missing Developer ID signature: $target"; exit 1; }
  if [[ -n "${APPLE_TEAM_ID:-}" && "$signature" != *"TeamIdentifier=$APPLE_TEAM_ID"* ]]; then
    echo "Unexpected Apple signing team: $target"; exit 1
  fi
done

NOTARY_WORK=$(mktemp -d)
trap 'rm -rf "$NOTARY_WORK"' EXIT

echo "Submitting $DMG to Apple…"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait --timeout 30m --output-format json > "$NOTARY_WORK/result.json"
node -e 'const r=require(process.argv[1]); if(r.status!=="Accepted") throw new Error("Apple notarization was not accepted: "+r.status); console.log("Apple notarization accepted: "+r.id);' "$NOTARY_WORK/result.json"
xcrun stapler staple "$DMG"
xcrun stapler staple "$APP"
xcrun stapler validate "$DMG"
xcrun stapler validate "$APP"
spctl --assess --type execute --verbose=2 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

# Recreate the ZIP so it contains the app's newly stapled ticket.
ditto -c -k --sequesterRsrc --keepParent "$APP" "$NOTARY_WORK/ChapterOne.zip"
mv "$NOTARY_WORK/ChapterOne.zip" "$ZIP"
ditto -x -k "$ZIP" "$NOTARY_WORK/zip-check"
codesign --verify --deep --strict --verbose=2 "$NOTARY_WORK/zip-check/ChapterOne.app"
xcrun stapler validate "$NOTARY_WORK/zip-check/ChapterOne.app"
spctl --assess --type execute --verbose=2 "$NOTARY_WORK/zip-check/ChapterOne.app"
echo "Notarization verified; DMG and ZIP updated. Recalculate release checksums."
