'use strict';

const { run, probeVersion, enforceMinWords } = require('./spawn');
const { SUBSCRIPTION_SCRUB } = require('./models');

/**
 * Adapter for Google's Gemini CLI running non-interactively.
 * Uses the user's Google/Gemini subscription login — we strip GEMINI_API_KEY /
 * GOOGLE_API_KEY from the child env so it authenticates with the subscription.
 *
 * Headless usage: `gemini -p "<prompt>"` runs once and prints the response.
 * Gemini grounds answers with built-in Google Search when helpful.
 */
class GeminiAdapter {
  constructor(config = {}) {
    this.id = 'gemini';
    this.label = 'Gemini CLI';
    this.command = config.command || 'gemini';
    this.model = config.model || '';
    this.extraArgs = config.extraArgs || [];
    this.forceSubscription = config.forceSubscription !== false;
  }

  scrub() {
    return this.forceSubscription ? SUBSCRIPTION_SCRUB.gemini : [];
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
      const ok = text.trim().length > 0; // a successful, non-empty completion = authenticated
      return { ok, detail: ok ? 'Authenticated (subscription)' : 'The CLI returned no output.' };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  buildArgs(prompt, opts = {}) {
    const args = [];
    if (this.model) args.push('-m', this.model);
    if (this.extraArgs.length) args.push(...this.extraArgs);
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    args.push('-p', full);
    return args;
  }

  async complete(prompt, opts = {}) {
    const args = this.buildArgs(prompt, opts);
    const { code, stdout, stderr } = await run(this.command, args, {
      scrubEnv: this.scrub(),
      timeoutMs: opts.timeoutMs || 0,
      signal: opts.signal,
      onStdout: opts.onStdout,
    });
    if (code !== 0 && !stdout.trim()) {
      throw new Error(`Gemini CLI exited with code ${code}: ${stderr.trim() || 'no output'}`);
    }
    const out = this.extractFinal(stdout).trim();
    enforceMinWords(out, opts);
    return out;
  }

  extractFinal(raw) {
    if (!raw) return '';
    // Drop common Gemini CLI status lines (e.g. cached-credential notices).
    return raw
      .split('\n')
      .filter((l) => !/^(Loaded cached credentials|Data collection|MCP STDERR|\[dotenv)/i.test(l.trim()))
      .join('\n');
  }
}

module.exports = { GeminiAdapter };
