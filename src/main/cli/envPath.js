'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * macOS/Linux GUI apps launched from Finder/Dock inherit a *minimal* PATH
 * (typically `/usr/bin:/bin:/usr/sbin:/sbin`) — NOT the user's interactive
 * shell PATH. So CLIs installed under `~/.local/bin`, Homebrew, nvm, pnpm, etc.
 * are invisible and `spawn('claude')` fails with ENOENT, even though the same
 * command works fine in a terminal.
 *
 * This module reconstructs the real PATH (by asking the login shell, plus a set
 * of well-known install locations) and applies it to `process.env.PATH` so
 * every child process we spawn can find the user's CLIs.
 */

/** Ask the user's login shell to print its PATH (captures nvm/asdf/rc edits). */
function shellPath() {
  if (process.platform === 'win32') return '';
  const shell = process.env.SHELL || '/bin/zsh';
  const marker = '__CO_PATH__';
  try {
    // -l (login) + -i (interactive) so rc/profile files that set PATH run.
    const out = execFileSync(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], {
      encoding: 'utf8',
      timeout: 6000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.split(marker);
    return (m.length >= 2 ? m[1] : '').trim();
  } catch (_) {
    return '';
  }
}

/** Common per-user and system locations CLIs get installed into. */
function commonDirs() {
  const home = os.homedir();
  const dirs = [
    '/opt/homebrew/bin', '/opt/homebrew/sbin',          // Apple Silicon Homebrew
    '/usr/local/bin', '/usr/local/sbin',                // Intel Homebrew / node
    path.join(home, '.local', 'bin'),                   // pipx / standalone installers
    path.join(home, 'bin'),
    path.join(home, 'local', 'node', 'bin'),            // manual node prefix
    path.join(home, '.npm-global', 'bin'),              // npm prefix=~/.npm-global
    path.join(home, '.npm-packages', 'bin'),
    path.join(home, 'Library', 'pnpm'),                 // pnpm
    path.join(home, '.bun', 'bin'),                     // bun
    path.join(home, '.deno', 'bin'),                    // deno
    path.join(home, '.volta', 'bin'),                   // volta
    path.join(home, '.asdf', 'shims'),                  // asdf
    path.join(home, '.cargo', 'bin'),
    '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  // nvm: include the active/default version's bin if present.
  try {
    const nvmVersions = path.join(home, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvmVersions)) dirs.push(path.join(nvmVersions, v, 'bin'));
  } catch (_) { /* no nvm */ }
  return dirs;
}

/** Build a de-duplicated PATH from the shell PATH, current PATH, and known dirs. */
function resolveUserPath() {
  if (process.platform === 'win32') return process.env.PATH || '';
  const sep = path.delimiter;
  const parts = [
    ...shellPath().split(sep),
    ...(process.env.PATH || '').split(sep),
    ...commonDirs(),
  ].map((p) => p && p.trim()).filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const p of parts) {
    if (!seen.has(p)) { seen.add(p); merged.push(p); }
  }
  return merged.join(sep);
}

/** Apply the resolved PATH to this process so all child spawns inherit it. */
function applyUserPath() {
  const merged = resolveUserPath();
  if (merged) process.env.PATH = merged;
  return merged;
}

module.exports = { resolveUserPath, applyUserPath, shellPath, commonDirs };
