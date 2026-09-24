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
      // The documented login-status subcommand reads authentication metadata.
      // Never fall back to exec: startup/status checks must not spend quota.
      // https://learn.chatgpt.com/docs/developer-commands?surface=cli
      const { code, stdout, stderr } = await run(this.command, ['login', 'status'], {
        scrubEnv: this.scrub(), timeoutMs: 15000,
      });
      const status = `${stdout}\n${stderr}`;
      // Codex may print an API-key fragment. Never forward raw output to the UI.
      if (code === 0 && /^Logged in using\b/im.test(status)) return { ok: true,
        detail: 'Codex reports signed in. No text was generated; model access, quota and billing were not checked.' };
      if (code === 1 && /^Not logged in\s*$/im.test(status)) return { ok: false,
        detail: 'Codex reports no sign-in. Sign in with the CLI, then check again.' };
    } catch (_) { /* unavailable or older CLI: unknown, with no paid fallback */ }
    return { ok: null,
      detail: 'Could not read Codex sign-in status. Update the CLI or check it in Terminal. No text was generated.' };
  }

  buildArgs(prompt, opts = {}) {
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
      '-c', 'approval_policy="never"', '-c', 'features.shell_tool=false'];
    // Keep a consistent reasoning budget for prose across model generations.
    // Medium is supported by the current catalog; user overrides stay intact.
    // Provider defaults and actual quality/usage vary by model and account.
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
