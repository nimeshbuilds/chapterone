'use strict';

const { spawn } = require('child_process');

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

    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      try {
        child.kill('SIGTERM');
      } catch (_) {
        /* ignore */
      }
      // Hard kill shortly after if it ignores SIGTERM.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
      }, 2000);
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

    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      if (onStdout) onStdout(s);
    });

    child.stderr.on('data', (d) => {
      const s = d.toString();
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
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });

    if (input != null) {
      child.stdin.write(input);
    }
    child.stdin.end();
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
    if (code === 0 || out) {
      return { found: true, version: out.split('\n')[0] || null, error: null };
    }
    return { found: false, version: null, error: out || `exit ${code}` };
  } catch (err) {
    return { found: false, version: null, error: err.message };
  }
}

module.exports = { run, probeVersion };
