'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const pkg = require('../package.json');
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
if (tag && tag !== `v${pkg.version}`) throw new Error(`Tag ${tag} does not match package version v${pkg.version}.`);
const files = [
  `ChapterOne-${pkg.version}-mac-universal.dmg`,
  `ChapterOne-${pkg.version}-mac-universal.zip`,
  `ChapterOne-${pkg.version}-win-x64-setup.exe`,
  `ChapterOne-${pkg.version}-win-arm64-setup.exe`,
];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const allowUnsignedWindows = process.env.CHAPTERONE_UNSIGNED_WINDOWS_VERSION === pkg.version;

if (process.argv.includes('--signing')) {
  // An owner-approved exception applies only to Windows and one exact version.
  // Partial credentials still fail; they must never silently become unsigned.
  const windowsSecrets = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
  const windowsConfigured = windowsSecrets.filter((name) => process.env[`${name}_PRESENT`] === 'true');
  const unsignedWindows = allowUnsignedWindows && windowsConfigured.length === 0;
  const required = ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', ...(unsignedWindows ? [] : windowsSecrets)];
  const missing = required.filter((name) => process.env[`${name}_PRESENT`] !== 'true');
  if (missing.length) throw new Error(`Signed releases require all signing secrets. Missing: ${missing.join(', ')}. See SIGNING.md.`);
  const result = `mac_signing=signed\nwindows_signing=${unsignedWindows ? 'unsigned' : 'signed'}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, result);
  console.log(result.trim());
}

if (process.argv.includes('--assets')) {
  const sums = files.map((name) => {
    const data = fs.readFileSync(path.join('release', name));
    if (data.length < 1024 * 1024) throw new Error(`Installer is unexpectedly small: ${name}`);
    return `${sha256(data)}  ${name}`;
  });
  fs.writeFileSync('release/SHA256SUMS.txt', sums.join('\n') + '\n');
  console.log('All four release assets verified; SHA256SUMS.txt written.');
}

if (process.argv.includes('--notes')) {
  const { MAC_SIGNING, WINDOWS_SIGNING, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID } = process.env;
  if (MAC_SIGNING !== 'signed' || !(WINDOWS_SIGNING === 'signed' || (WINDOWS_SIGNING === 'unsigned' && allowUnsignedWindows))) {
    throw new Error('Release publication requires signed macOS builds and signed Windows builds or an exception for this exact version.');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY || '') || !/^[a-f0-9]{40}$/.test(GITHUB_SHA || '') || !/^\d+$/.test(GITHUB_RUN_ID || '')) {
    throw new Error('Release notes require the repository, exact commit, and build run.');
  }
  const values = {
    VERSION: pkg.version,
    REPOSITORY: GITHUB_REPOSITORY,
    COMMIT: GITHUB_SHA,
    BUILD_URL: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
    MAC_SIGNING: 'Developer ID signed and notarized. The app and DMG signatures, Gatekeeper assessments, and stapled notarization tickets were verified, including the app extracted from the ZIP.',
    WINDOWS_SIGNING: WINDOWS_SIGNING === 'signed'
      ? 'Authenticode signed and timestamped. Each installer and its packaged app executable were verified.'
      : 'UNSIGNED — the owner approved unsigned Windows x64 and ARM64 installers for this version. Publisher identity is not verified, and Windows may show an Unknown publisher or SmartScreen warning. The native builds and source/packaged application tests passed; SHA256 checksums are provided.',
  };
  const template = fs.readFileSync(path.join(__dirname, '../.github/RELEASE_NOTES.md'), 'utf8');
  const notes = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown release note field: ${key}`);
    return values[key];
  });
  fs.writeFileSync('release/RELEASE_NOTES.md', notes);
}

if (process.argv.includes('--uploaded-assets')) {
  const uploaded = JSON.parse(fs.readFileSync('release/uploaded-release.json', 'utf8'));
  if (uploaded.tag_name !== `v${pkg.version}` || uploaded.draft !== true) throw new Error('Expected the current version as an unpublished draft.');
  const expected = [...files, 'SHA256SUMS.txt'];
  if (uploaded.assets.length !== expected.length) throw new Error('Uploaded release asset count is incorrect.');
  for (const name of expected) {
    const data = fs.readFileSync(path.join('release', name));
    const asset = uploaded.assets.find((candidate) => candidate.name === name);
    if (!asset || asset.state !== 'uploaded' || asset.size !== data.length || asset.digest !== `sha256:${sha256(data)}`) {
      throw new Error(`Uploaded asset is missing, incomplete, or has a different checksum: ${name}`);
    }
  }
  console.log('All uploaded assets match the local sizes and SHA256 digests; ready to publish.');
}
