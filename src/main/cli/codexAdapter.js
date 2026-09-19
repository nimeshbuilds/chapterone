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
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false'];
    // Codex defaults to `xhigh` reasoning (built for hard coding/math): for prose
    // it is slow and burns the ChatGPT quota fast, so a full book hits usage/rate
    // limits and starts failing. `medium` keeps the writing quality while cutting
    // token use ~3-5x and running far faster. The user can override via extraArgs.
    const hasReasoning = this.extraArgs.some((a) => /model_reasoning_effort/.test(String(a)));
    if (!hasReasoning) args.push('-c', 'model_reasoning_effort="medium"');
    if (this.model) args.push('--model', this.model);
    // Web-search grounding. Newer Codex (>=0.x) replaced the `--search` flag with
    // a config tool toggle; the old flag now errors with "unexpected argument
    // '--search'", which was failing every research-enabled call.
    args.push('-c', `web_search="${opts.research ? 'live' : 'disabled'}"`);
    if (this.extraArgs.length) args.push(...this.extraArgs);
    // '-' = read the prompt from stdin. Passing the full multi-KB prompt as an
    // argv element broke on Windows (32K command-line limit) and pollutes `ps`;
    // stdin is unbounded and identical on every platform.
    args.push('-');
    return args;
  }

  async complete(prompt, opts = {}) {
    const args = this.buildArgs(prompt, opts);
    const full = opts.system ? `${opts.system}\n\n${prompt}` : prompt;
    const { code, stdout, stderr } = await run(this.command, args, {
      input: full,
      scrubEnv: this.scrub(),
      timeoutMs: opts.timeoutMs || 0,
      signal: opts.signal,
      onStdout: opts.onStdout,
    });
    if (code !== 0) {
      throw new Error(
        `Codex CLI exited with code ${code}: ${stderr.trim() || 'no output'}`
      );
    }
    const out = this.extractFinal(stdout).trim();
    enforceMinWords(out, opts);
    return out;
  }

  /**
   * Codex prints a banner (model/provider/session), echoes the user prompt,
   * then a bare `codex` line, THE MESSAGE, and a `tokens used` trailer. Slice
   * between the last `codex` marker and the trailer instead of pattern-
   * filtering every line — the old filter deleted legitimate book content
   * ('---' scene breaks, timeline lines starting with an ISO date).
   */
  extractFinal(raw) {
    if (!raw) return '';
    const lines = raw.split('\n');
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^codex$/i.test(lines[i].trim())) start = i + 1;
    }
    if (start >= 0) {
      for (let i = start; i < lines.length; i++) {
        if (/^tokens used\b/i.test(lines[i].trim())) { end = i; break; }
      }
      return lines.slice(start, end).join('\n');
    }
    // Fallback (unexpected format): strip only the known banner lines.
    return lines.filter((l) => {
      const t = l.trim();
      return !/^(model|provider|reasoning|workdir|sandbox|approval|session id|tokens used)\s*:/i.test(t)
        && !/^-{8,}$/.test(t)
        && !/^Reading additional input from stdin/i.test(t);
    }).join('\n');
  }
}

module.exports = { CodexAdapter };
