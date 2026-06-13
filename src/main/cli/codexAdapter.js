'use strict';

const { run, probeVersion, enforceMinWords } = require('./spawn');
const { SUBSCRIPTION_SCRUB } = require('./models');

/**
 * Adapter for OpenAI's Codex CLI running non-interactively.
 * Uses the user's existing ChatGPT/Codex login — we never handle API keys and
 * we strip OPENAI_API_KEY from the child env so the CLI uses the subscription.
 *
 * Headless usage: `codex exec "<prompt>"` runs once and prints the final
 * assistant message.
 */
class CodexAdapter {
  constructor(config = {}) {
    this.id = 'codex';
    this.label = 'Codex CLI';
    this.command = config.command || 'codex';
    this.model = config.model || '';
    this.extraArgs = config.extraArgs || [];
    this.forceSubscription = config.forceSubscription !== false;
  }

  scrub() {
    return this.forceSubscription ? SUBSCRIPTION_SCRUB.codex : [];
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
    const args = ['exec', '--skip-git-repo-check'];
    if (this.model) args.push('--model', this.model);
    if (opts.research) args.push('--search'); // enable web search grounding
    if (this.extraArgs.length) args.push(...this.extraArgs);
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    args.push(full);
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
      throw new Error(
        `Codex CLI exited with code ${code}: ${stderr.trim() || 'no output'}`
      );
    }
    const out = this.extractFinal(stdout).trim();
    enforceMinWords(out, opts);
    return out;
  }

  extractFinal(raw) {
    if (!raw) return '';
    const lines = raw.split('\n');
    const cleaned = lines.filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (/^\[?\d{4}-\d{2}-\d{2}/.test(t)) return false;
      if (/^(codex|model|provider|reasoning|workdir|sandbox|tokens used)\s*[:=]/i.test(t)) return false;
      if (/^-{3,}$/.test(t)) return false;
      return true;
    });
    return cleaned.join('\n');
  }
}

module.exports = { CodexAdapter };
