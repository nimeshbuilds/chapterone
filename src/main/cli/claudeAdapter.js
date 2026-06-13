'use strict';

const { run, probeVersion, enforceMinWords } = require('./spawn');
const { SUBSCRIPTION_SCRUB } = require('./models');

/**
 * Adapter for Anthropic's Claude Code CLI running in headless/print mode.
 * Uses the user's existing Claude subscription/login — we never handle API keys
 * and we actively strip ANTHROPIC_API_KEY from the child env so the CLI falls
 * back to the interactive subscription login.
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
    this.forceSubscription = config.forceSubscription !== false;
  }

  scrub() {
    return this.forceSubscription ? SUBSCRIPTION_SCRUB.claude : [];
  }

  async detect() {
    return probeVersion(this.command, ['--version']);
  }

  async checkAuth() {
    try {
      const text = await this.complete('Reply with exactly the word: READY', {
        system: 'You are a connectivity probe. Output only what is requested.',
        timeoutMs: 60000,
      });
      const ok = text.trim().length > 0; // a successful, non-empty completion = authenticated
      return { ok, detail: ok ? 'Authenticated (subscription)' : 'The CLI returned no output.' };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  buildArgs(opts = {}) {
    const args = ['-p', '--output-format', 'text'];
    if (this.model) args.push('--model', this.model);

    if (opts.research) {
      // Allow only the read-only web tools — never file edits or shell.
      args.push('--allowedTools', 'WebSearch,WebFetch');
    } else {
      // Pure text generation: plan mode disables all tool/file actions.
      args.push('--permission-mode', 'plan');
    }

    if (opts.system) args.push('--append-system-prompt', opts.system);
    if (this.extraArgs.length) args.push(...this.extraArgs);
    return args;
  }

  /**
   * @param {string} prompt
   * @param {object} [opts]
   * @param {string} [opts.system]
   * @param {boolean} [opts.research]   Enable WebSearch/WebFetch grounding.
   * @param {number} [opts.timeoutMs]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<string>}
   */
  async complete(prompt, opts = {}) {
    const args = this.buildArgs(opts);
    const { code, stdout, stderr } = await run(this.command, args, {
      input: prompt,
      scrubEnv: this.scrub(),
      timeoutMs: opts.timeoutMs || 0,
      signal: opts.signal,
      onStdout: opts.onStdout,
    });
    if (code !== 0 && !stdout.trim()) {
      throw new Error(
        `Claude CLI exited with code ${code}: ${stderr.trim() || 'no output'}`
      );
    }
    const out = stdout.trim();
    enforceMinWords(out, opts);
    return out;
  }
}

module.exports = { ClaudeAdapter };
