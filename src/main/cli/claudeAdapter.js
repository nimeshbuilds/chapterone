'use strict';

const { run, probeVersion } = require('./spawn');

/**
 * Adapter for Anthropic's Claude Code CLI running in headless/print mode.
 * Uses the user's existing Claude subscription/login — we never handle API keys.
 *
 * Headless usage: `claude -p` reads the prompt from stdin and prints the
 * assistant's final text response to stdout.
 */
class ClaudeAdapter {
  constructor(config = {}) {
    this.id = 'claude';
    this.label = 'Claude Code CLI';
    this.command = config.command || 'claude';
    this.model = config.model || ''; // empty => CLI default
    this.extraArgs = config.extraArgs || [];
  }

  /** @returns {Promise<{found:boolean, version:string|null, error:string|null}>} */
  async detect() {
    return probeVersion(this.command, ['--version']);
  }

  /**
   * Lightweight authentication / connectivity check by asking the model to
   * echo a token. If the CLI is unauthenticated it errors out instead.
   */
  async checkAuth() {
    try {
      const text = await this.complete('Reply with exactly the word: READY', {
        system: 'You are a connectivity probe. Output only what is requested.',
        timeoutMs: 60000,
      });
      const ok = /READY/i.test(text);
      return { ok, detail: ok ? 'Authenticated' : `Unexpected response: ${text.slice(0, 120)}` };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  buildArgs() {
    const args = ['-p', '--output-format', 'text'];
    if (this.model) args.push('--model', this.model);
    // Keep the working session sandboxed: no tools needed for prose generation.
    args.push('--permission-mode', 'plan');
    if (this.extraArgs.length) args.push(...this.extraArgs);
    return args;
  }

  /**
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string} [opts.system]      Prepended as a role/system framing.
   * @param {number} [opts.timeoutMs]
   * @param {AbortSignal} [opts.signal]
   * @param {(s:string)=>void} [opts.onStdout]
   * @returns {Promise<string>} The model's text output.
   */
  async complete(prompt, opts = {}) {
    const args = this.buildArgs();
    if (opts.system) {
      args.push('--append-system-prompt', opts.system);
    }
    const { code, stdout, stderr } = await run(this.command, args, {
      input: prompt,
      timeoutMs: opts.timeoutMs || 0,
      signal: opts.signal,
      onStdout: opts.onStdout,
    });
    if (code !== 0 && !stdout.trim()) {
      throw new Error(
        `Claude CLI exited with code ${code}: ${stderr.trim() || 'no output'}`
      );
    }
    return stdout.trim();
  }
}

module.exports = { ClaudeAdapter };
