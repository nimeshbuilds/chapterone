'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
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

  /**
   * Auth check WITHOUT spawning the CLI. Running `grok -p` while signed out
   * launches an interactive browser OAuth flow — so polling it (as the sign-in
   * modal does) opened a new browser tab with a fresh code every few seconds.
   * Instead we look for the locally-cached auth token Grok writes after
   * `grok login` (config dir ~/.grok-build, override with GROK_HOME). No CLI
   * call, no browser.
   */
  async checkAuth() {
    try {
      // Grok stores the session token in ~/.grok/auth.json (key host auth.x.ai).
      // An explicit GROK_HOME wins exclusively; otherwise check ~/.grok then the
      // legacy ~/.grok-build.
      const candidates = process.env.GROK_HOME
        ? [process.env.GROK_HOME]
        : [path.join(os.homedir(), '.grok'), path.join(os.homedir(), '.grok-build')];
      for (const home of candidates) {
        if (fs.existsSync(home) && this._scanForToken(home, 0)) {
          return { ok: true, detail: 'Signed in (subscription)' };
        }
      }
      return { ok: false, detail: 'Not signed in — run “grok login” in Terminal.' };
    } catch (_) {
      return { ok: false, detail: 'Not signed in.' };
    }
  }

  /**
   * Shallow-recursive search for a credentials/token file — matched by an
   * auth-ish filename OR by token-signature content (so it still works if Grok
   * names the file something unexpected).
   */
  _scanForToken(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return false; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          if (st.size <= 2) continue;
          if (/(auth|token|credential|session|oauth|account)/i.test(e.name)) return true;
          if (st.size < 65536) {
            const txt = fs.readFileSync(full, 'utf8');
            if (/xai-[A-Za-z0-9]|access_token|refresh_token|"?(id|access)_?token"?\s*[:=]/i.test(txt)) return true;
          }
        } catch (_) { /* skip unreadable */ }
      } else if (e.isDirectory() && depth < 2 && !/node_modules|cache|logs/i.test(e.name)) {
        if (this._scanForToken(full, depth + 1)) return true;
      }
    }
    return false;
  }

  buildArgs(prompt, opts = {}) {
    // `-p/--single` = headless single prompt; plain output is clean assistant text.
    const args = ['--no-auto-update', '--output-format', 'plain'];
    if (this.model) args.push('--model', this.model);
    if (opts.research === false) args.push('--disable-web-search'); // search is on by default
    if (this.extraArgs.length) args.push(...this.extraArgs);
    // Grok has no separate system-prompt flag in headless mode, so fold it in.
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
