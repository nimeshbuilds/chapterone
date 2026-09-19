'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * On Windows, globally-installed npm CLIs are `.cmd` shims — and Node (since the
 * CVE-2024-27980 hardening, shipped in the Electron we bundle) REFUSES to spawn
 * `.cmd`/`.bat` files with shell:false (EINVAL). Spawning them with shell:true is
 * not an option either: book prompts are arbitrary multi-line text that cannot be
 * safely escaped for cmd.exe. So on Windows we resolve the shim to the real
 * JavaScript entry it points at and run it with OUR OWN runtime:
 *   spawn(process.execPath, [cliJs, ...args], { env: { ELECTRON_RUN_AS_NODE: 1 } })
 * which keeps shell:false (args passed verbatim, no quoting, no 8K cmd limit).
 *
 * Returns { command, args, env } ready for spawn(). On macOS/Linux it's a no-op.
 */
function resolveSpawn(command, args, env) {
  if (process.platform !== 'win32') return { command, args, env };

  // Absolute/explicit paths with a runnable extension pass through untouched.
  const looksBare = command && !command.includes('\\') && !command.includes('/') && !path.extname(command);
  let full = command;
  if (looksBare) {
    const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    outer:
    for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
      for (const ext of exts) {
        const cand = path.join(dir, command + ext);
        try { if (fs.existsSync(cand)) { full = cand; break outer; } } catch (_) { /* skip */ }
      }
    }
  }

  const ext = path.extname(full).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { command: full, args, env };

  // npm shims embed the relative path of the real JS entry, e.g.
  //   "%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
  // Parse it and run that file with our bundled Node (ELECTRON_RUN_AS_NODE).
  try {
    const shimDir = path.dirname(full);
    const text = fs.readFileSync(full, 'utf8');
    const m = text.match(/(?:%(?:~?dp0|dp0%)[\\/]*)((?:[^\s"%]|\\ )*?node_modules[\\/][^\s"%]+?\.(?:js|cjs|mjs))/i)
      || text.match(/"([^"]*node_modules[\\/][^"]+?\.(?:js|cjs|mjs))"/i);
    if (m) {
      let jsRel = m[1].replace(/^[\\/]+/, '');
      const jsAbs = path.isAbsolute(jsRel) ? jsRel : path.join(shimDir, jsRel);
      if (fs.existsSync(jsAbs)) {
        return {
          command: process.execPath,
          args: [jsAbs, ...args],
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        };
      }
    }
  } catch (_) { /* fall through to the clear error below */ }

  // We refuse to silently run a .cmd through cmd.exe with arbitrary args.
  throw new Error(
    `Cannot run "${command}" on Windows: it resolves to a batch shim (${full}) whose ` +
    'JavaScript entry could not be located. Reinstall the CLI with "npm install -g" and try again.'
  );
}

/**
 * Run a command, optionally feeding `input` on stdin, and resolve with the
 * captured stdout. Designed for headless CLI invocations (claude -p / codex exec).
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} [opts]
 * @param {string} [opts.input]        Text to write to the child's stdin.
 * @param {object} [opts.env]          Extra environment variables.
 * @param {number} [opts.timeoutMs]    Kill the child after this many ms.
 * @param {AbortSignal} [opts.signal]  Abort the run.
 * @param {(chunk:string)=>void} [opts.onStdout] Streamed stdout callback.
 * @param {(chunk:string)=>void} [opts.onStderr] Streamed stderr callback.
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function run(command, args = [], opts = {}) {
  const {
    input,
    env,
    scrubEnv = [],
    timeoutMs = 0,
    signal,
    onStdout,
    onStderr,
    cwd,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Aborted before start'));
      return;
    }

    // Build the child environment, then strip any keys that would force
    // API-key billing so the CLI uses the user's subscription login instead.
    const childEnv = { ...process.env, ...(env || {}) };
    for (const key of scrubEnv) delete childEnv[key];

    let child;
    try {
      const r = resolveSpawn(command, args, childEnv);
      child = spawn(r.command, r.args, {
        cwd,
        env: r.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let aborted = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const killTree = () => {
      if (process.platform === 'win32') {
        // kill() only reaches the direct child; a CLI's own subprocess tree
        // would keep running (and burning quota). taskkill /T takes the tree.
        try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {}); } catch (_) { /* ignore */ }
        return;
      }
      try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { /* already exited */ }
      const forceKill = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { /* already exited */ } }, 2000);
      forceKill.unref();
      child.once('close', () => clearTimeout(forceKill));
    };

    const onAbort = () => {
      if (settled) return;
      aborted = true;
      killTree();
    };

    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        onAbort();
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
        }
      }, timeoutMs);
    }

    // setEncoding uses a StringDecoder, so multi-byte UTF-8 characters split
    // across pipe chunks are reassembled correctly (no U+FFFD corruption).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (s) => {
      stdout += s;
      if (onStdout) onStdout(s);
    });

    child.stderr.on('data', (s) => {
      stderr += s;
      if (onStderr) onStderr(s);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      // A user cancel/abort must REJECT (clearly "cancelled"), never resolve with
      // a partial/short result that downstream would treat as success or retry.
      if (aborted) { reject(new Error('Generation cancelled by user')); return; }
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });

    // A child that exits (or crashes) before consuming stdin makes the pipe
    // emit EPIPE; without a handler that's an uncaught 'error' event that
    // takes down the whole main process. Swallow it — 'close' still fires.
    child.stdin.on('error', () => {});
    try {
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    } catch (_) { /* EPIPE race — the close handler reports the real outcome */ }
  });
}

/**
 * Resolve whether a command exists and capture its --version output.
 * @returns {Promise<{found:boolean, version:string|null, error:string|null}>}
 */
async function probeVersion(command, versionArgs = ['--version'], timeoutMs = 8000) {
  try {
    const { code, stdout, stderr } = await run(command, versionArgs, { timeoutMs });
    const out = (stdout || stderr || '').trim();
    if (code === 0) {
      return { found: true, version: out.split('\n')[0] || null, error: null };
    }
    return { found: false, version: null, error: out || `exit ${code}` };
  } catch (err) {
    return { found: false, version: null, error: err.message };
  }
}

/**
 * Throw a fallback-able error if a completion is suspiciously short. A CLI that
 * has hit a usage/rate limit often returns a tiny message with exit 0 (not an
 * error), which would otherwise be accepted. Throwing here lets the ChainEngine
 * fall back to the next provider. Only applied when opts.minWords is set.
 */
function enforceMinWords(text, opts) {
  if (opts && opts.minWords) {
    const n = (String(text || '').match(/\S+/g) || []).length;
    if (n < opts.minWords) {
      throw new Error(`The CLI returned only ${n} words (expected at least ${opts.minWords}). This usually means a usage or rate limit was hit; trying the next engine if one is available.`);
    }
  }
}

module.exports = { run, probeVersion, enforceMinWords, resolveSpawn };
