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

if (process.argv.includes('--signing')) {
  // Only presence flags reach this job. Both platforms require signing; an old
  // unsigned opt-in must never authorize a release again.
  const required = ['MAC_CSC_LINK', 'MAC_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
  const missing = required.filter((name) => process.env[`${name}_PRESENT`] !== 'true');
  if (missing.length) throw new Error(`Signed releases require all signing secrets. Missing: ${missing.join(', ')}. See SIGNING.md.`);
  const result = 'mac_signing=signed\nwindows_signing=signed\n';
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
  if (MAC_SIGNING !== 'signed' || WINDOWS_SIGNING !== 'signed') {
    throw new Error('Release publication requires signed macOS and Windows builds.');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY || '') || !/^[a-f0-9]{40}$/.test(GITHUB_SHA || '') || !/^\d+$/.test(GITHUB_RUN_ID || '')) {
    throw new Error('Release notes require the repository, exact commit, and build run.');
  }
  const values = {
    VERSION: pkg.version,
    REPOSITORY: GITHUB_REPOSITORY,
    COMMIT: GITHUB_SHA,
    BUILD_URL: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
    MAC_SIGNING: 'Developer ID signed and notarized. The workflow verified the app and DMG signatures, Gatekeeper assessments, and stapled notarization tickets, including the app extracted from the ZIP.',
    WINDOWS_SIGNING: 'Authenticode signed and timestamped. The workflow verified each installer and its packaged app executable.',
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
