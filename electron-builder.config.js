'use strict';

/**
 * electron-builder configuration.
 *
 * The build settings live in package.json `build`; this wrapper only adds the
 * one thing that must be conditional: notarization. Notarization (and the
 * Developer ID signature it depends on) turn ON automatically when the Apple
 * credentials below are present in the environment, and stay OFF otherwise — so
 * the unsigned local/dev build keeps working with no changes.
 *
 * To produce a signed + notarized DMG that opens with NO Gatekeeper warning,
 * see SIGNING.md and export:
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 * (plus a "Developer ID Application" certificate in your login keychain).
 */

const pkg = require('./package.json');

const hasAppleCreds = !!(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
);

if (process.env.CHAPTERONE_RELEASE === 'true' && process.platform === 'darwin'
  && process.env.CHAPTERONE_ALLOW_UNSIGNED_RELEASE !== 'true'
  && (!hasAppleCreds || !process.env.CSC_LINK)) {
  throw new Error('Tagged macOS releases require signing/notarization secrets or an explicit unsigned release opt-in. See SIGNING.md.');
}

module.exports = {
  ...pkg.build,
  mac: {
    ...pkg.build.mac,
    // notarytool credentials are read from the env; false = skip (unsigned build).
    notarize: hasAppleCreds,
  },
};
