'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const pkg = require('../package.json');
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
if (tag && tag !== `v${pkg.version}`) throw new Error(`Tag ${tag} does not match package version v${pkg.version}.`);
if (process.argv.includes('--assets')) {
  const files = [
    `ChapterOne-${pkg.version}-mac-universal.dmg`,
    `ChapterOne-${pkg.version}-mac-universal.zip`,
    `ChapterOne-${pkg.version}-win-x64-setup.exe`,
    `ChapterOne-${pkg.version}-win-arm64-setup.exe`,
  ];
  const sums = files.map((name) => {
    const data = fs.readFileSync(path.join('release', name));
    if (data.length < 1024 * 1024) throw new Error(`Installer is unexpectedly small: ${name}`);
    return `${createHash('sha256').update(data).digest('hex')}  ${name}`;
  });
  fs.writeFileSync('release/SHA256SUMS.txt', sums.join('\n') + '\n');
  console.log('All four release assets verified; SHA256SUMS.txt written.');
}
