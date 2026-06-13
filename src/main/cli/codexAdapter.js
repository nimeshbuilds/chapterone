'use strict';

const { run, probeVersion } = require('./spawn');

/**
 * Adapter for OpenAI's Codex CLI running non-interactively.
 * Uses the user's existing ChatGPT/OpenAI login — we never handle API keys.
 *
 * Headless usage: `codex exec "<prompt>"` runs once and prints the final
 * assistant message. We pass the prompt as an argument and request the final
 * message only where supported.
 */
class CodexAdapter {
  constructor(config = {}) {
    this.id = 'codex';
    this.label = 'Codex CLI';
    this.command = config.command || 'codex';
    this.model = config.model || '';
    this.extraArgs = config.extraArgs || [];
  }

  async detect() {
    return probeVersion(this.command, ['--version']);
  }

  async checkAuth() {
    try {
      const text = await this.complete('Reply with exactly the word: READY', {
        system: 'You are a connectivity probe. Output only what is requested.',
        timeoutMs: 90000,
      });
      const ok = /READY/i.test(text);
      return { ok, detail: ok ? 'Authenticated' : `Unexpected response: ${text.slice(0, 120)}` };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  buildArgs(prompt, system) {
    // `codex exec` with safety flags so it never edits the filesystem.
    const args = ['exec', '--skip-git-repo-check'];
    if (this.model) args.push('--model', this.model);
    if (this.extraArgs.length) args.push(...this.extraArgs);
    const full = system ? `${system}\n\n${prompt}` : prompt;
    args.push(full);
    return args;
  }

  /**
   * @param {string} prompt
   * @param {object} [opts]
   * @returns {Promise<string>}
   */
  async complete(prompt, opts = {}) {
    const args = this.buildArgs(prompt, opts.system);
    const { code, stdout, stderr } = await run(this.command, args, {
      timeoutMs: opts.timeoutMs || 0,
      signal: opts.signal,
      onStdout: opts.onStdout,
    });
    if (code !== 0 && !stdout.trim()) {
      throw new Error(
        `Codex CLI exited with code ${code}: ${stderr.trim() || 'no output'}`
      );
    }
    return this.extractFinal(stdout).trim();
  }

  /**
   * `codex exec` may print log/preamble lines before the final message.
   * Heuristically strip known noise; otherwise return the whole output.
   */
  extractFinal(raw) {
    if (!raw) return '';
    const lines = raw.split('\n');
    // Drop common codex log prefixes (timestamps, "codex", config echoes).
    const cleaned = lines.filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return false; // timestamps
      if (/^(codex|model|provider|reasoning|workdir|sandbox)\s*[:=]/i.test(t)) return false;
      if (/^-{3,}$/.test(t)) return false;
      return true;
    });
    return cleaned.join('\n');
  }
}

module.exports = { CodexAdapter };
