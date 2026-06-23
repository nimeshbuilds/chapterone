'use strict';

const { run, probeVersion, enforceMinWords } = require('./spawn');
const { SUBSCRIPTION_SCRUB } = require('./models');

/**
 * Adapter for xAI's Grok Build CLI running non-interactively.
 * Uses the user's existing SuperGrok / X Premium Plus subscription login — we
 * never handle API keys and we strip XAI_API_KEY / GROK_CODE_XAI_API_KEY from the
 * child env so the CLI uses the interactive (OAuth) subscription auth.
 *
 * Headless usage: `grok -p "<prompt>"` runs one prompt and prints the final
 * assistant message. `--no-auto-update` skips background update checks in scripts.
 */
class GrokAdapter {
  constructor(config = {}) {
    this.id = 'grok';
    this.label = 'Grok CLI';
    this.command = config.command || 'grok';
    this.model = config.model || ''; // empty => CLI default (grok-build-0.1)
    this.extraArgs = config.extraArgs || [];
    this.forceSubscription = config.forceSubscription !== false;
  }

  scrub() {
    return this.forceSubscription ? SUBSCRIPTION_SCRUB.grok : [];
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
    const args = ['--no-auto-update'];
    if (this.model) args.push('--model', this.model);
    if (this.extraArgs.length) args.push(...this.extraArgs);
    // Grok has no separate system-prompt flag in headless mode, so fold it in.
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    args.push('-p', full); // single-prompt headless mode
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
      throw new Error(`Grok CLI exited with code ${code}: ${stderr.trim() || 'no output'}`);
    }
    const out = this.extractFinal(stdout).trim();
    enforceMinWords(out, opts);
    return out;
  }

  /** Strip any leading status/banner lines Grok prints before the answer. */
  extractFinal(raw) {
    if (!raw) return '';
    const lines = String(raw).split('\n');
    const cleaned = lines.filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return false; // timestamps
      if (/^(grok|model|provider|reasoning|workdir|sandbox|tokens used|thinking)\s*[:=]/i.test(t)) return false;
      if (/^-{3,}$/.test(t)) return false;
      return true;
    });
    return cleaned.join('\n');
  }
}

module.exports = { GrokAdapter };
