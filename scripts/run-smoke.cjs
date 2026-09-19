'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chapterone-smoke-result-'));
const report = path.join(dir, 'result.json');
let code = 1;
try {
  const selfTest = process.argv.includes('--self-test');
  const args = selfTest ? ['--fail-smoke'] : process.argv.slice(2);
  const child = spawnSync(require('electron'), [path.join(__dirname, 'smoke.cjs'), ...args], {
    stdio: 'inherit', timeout: 210000,
    env: { ...process.env, CHAPTERONE_SMOKE_RESULT: report },
  });
  if (child.error) throw child.error;
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  if (selfTest) {
    if (child.status === 0 || result.ok !== false || result.error !== 'Intentional smoke failure') {
      throw new Error('Smoke runner did not propagate the intentional failure.');
    }
    console.log('Verified that a failed Electron smoke check returns a failing exit code.');
  } else {
    if (child.status !== 0 || result.ok !== true) throw new Error(`Electron smoke failed (exit ${child.status}).`);
    console.log(`Verified Electron smoke completion: ${result.platform}/${result.arch}.`);
  }
  code = 0;
} catch (error) {
  console.error(`Smoke verification failed: ${error.message}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exitCode = code;
