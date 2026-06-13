'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const URL_RE = /(https?:\/\/[^\s'"<>]+)/g;

/**
 * Manages interactive login child processes for the in-app "Sign in" flow.
 * Streams the CLI's output to the UI, surfaces any OAuth URL so it can be
 * opened in the user's browser, and forwards typed input (e.g. a pasted code)
 * to the process's stdin.
 */
class AuthSessionManager {
  constructor() {
    this.sessions = new Map();
  }

  /**
   * @param {object} opts
   * @param {string} opts.command
   * @param {string[]} opts.args
   * @param {string[]} [opts.scrubEnv]
   * @param {(text:string)=>void} opts.onOutput
   * @param {(url:string)=>void} opts.onUrl
   * @param {(code:number)=>void} opts.onClose
   * @returns {string} sessionId
   */
  start(opts) {
    const id = randomUUID();
    const env = { ...process.env };
    for (const k of opts.scrubEnv || []) delete env[k];

    let child;
    try {
      child = spawn(opts.command, opts.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    } catch (err) {
      // Surface spawn failure (e.g. command not found) as output + close.
      setImmediate(() => {
        opts.onOutput(`Could not start "${opts.command}": ${err.message}\n`);
        opts.onClose(-1);
      });
      return id;
    }

    const opened = new Set();
    const handle = (buf) => {
      const text = buf.toString();
      opts.onOutput(text);
      const matches = text.match(URL_RE);
      if (matches) {
        for (const u of matches) {
          if (!opened.has(u)) { opened.add(u); opts.onUrl(u); }
        }
      }
    };

    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', (err) => { opts.onOutput(`\n[error] ${err.message}\n`); });
    child.on('close', (code) => {
      this.sessions.delete(id);
      opts.onClose(code == null ? -1 : code);
    });

    this.sessions.set(id, child);
    return id;
  }

  input(id, text) {
    const child = this.sessions.get(id);
    if (!child) return false;
    try { child.stdin.write(text.endsWith('\n') ? text : text + '\n'); return true; }
    catch (_) { return false; }
  }

  cancel(id) {
    const child = this.sessions.get(id);
    if (!child) return false;
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    this.sessions.delete(id);
    return true;
  }

  disposeAll() {
    for (const child of this.sessions.values()) {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
    this.sessions.clear();
  }
}

module.exports = { AuthSessionManager, URL_RE };
