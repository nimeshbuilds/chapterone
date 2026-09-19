'use strict';

/**
 * electron-builder configuration.
 *
 * Release builds require Mac signing and notarization. Unsigned Windows
 * installers require an explicit exception for the exact package version.
 * Normal CI may still package unsigned test artifacts without release secrets.
 *
 * To produce a signed + notarized DMG that opens with NO Gatekeeper warning,
 * see SIGNING.md and export:
 *   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 * (plus a "Developer ID Application" certificate in your login keychain).
 */

const pkg = require('./package.json');
const isRelease = process.env.CHAPTERONE_RELEASE === 'true' || process.env.GITHUB_REF_TYPE === 'tag';
const allowUnsignedWindows = process.env.CHAPTERONE_UNSIGNED_WINDOWS_VERSION === pkg.version;

const hasAppleCreds = !!(
  (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
  || (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER)
  || process.env.APPLE_KEYCHAIN_PROFILE
);

if (isRelease && process.platform === 'darwin' && !hasAppleCreds) {
  throw new Error('macOS releases require Apple notarization credentials. See SIGNING.md.');
}

module.exports = {
  ...pkg.build,
  forceCodeSigning: isRelease && !(process.platform === 'win32' && allowUnsignedWindows),
  mac: {
    ...pkg.build.mac,
    forceCodeSigning: isRelease,
    notarize: hasAppleCreds,
  },
  win: { ...pkg.build.win, forceCodeSigning: isRelease && !allowUnsignedWindows },
  dmg: { ...pkg.build.dmg, sign: isRelease },
};
