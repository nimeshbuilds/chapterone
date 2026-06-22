'use strict';

const { run, probeVersion, enforceMinWords } = require('./spawn');

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'; // newest GA Flash: powerful + cheap

/**
 * Adapter for Google's Gemini CLI running non-interactively.
 *
 * Google retired the Gemini CLI's free "Code Assist for individuals" OAuth
 * login, so this engine authenticates with a **Gemini API key** (from
 * aistudio.google.com/apikey). We inject GEMINI_API_KEY into the child env and
 * never strip it. Billing is per-token, so the model defaults to a cheap Flash.
 *
 * Headless usage: `gemini -p "<prompt>"` runs once and prints the response.
 */
class GeminiAdapter {
  constructor(config = {}) {
    this.id = 'gemini';
    this.label = 'Gemini CLI';
    this.command = config.command || 'gemini';
    this.model = config.model || DEFAULT_GEMINI_MODEL;
    this.extraArgs = config.extraArgs || [];
    this.apiKey = (config.apiKey || '').trim();
  }

  /** Inject the API key + force the Gemini API (not Vertex) for the child. */
  env() {
    return this.apiKey
      ? { GEMINI_API_KEY: this.apiKey, GOOGLE_GENAI_USE_VERTEXAI: 'false' }
      : {};
  }

  async detect() {
    return probeVersion(this.command, ['--version']);
  }

  async checkAuth() {
    if (!this.apiKey) {
      return { ok: false, detail: 'Add a Gemini API key (aistudio.google.com/apikey) in Settings — Google retired the Gemini CLI individual login.' };
    }
    try {
      const text = await this.complete('Reply with exactly the word: READY', {
        system: 'You are a connectivity probe. Output only what is requested.',
        timeoutMs: 90000,
      });
      const ok = text.trim().length > 0; // a successful, non-empty completion = authenticated
      return { ok, detail: ok ? 'Authenticated (Gemini API key)' : 'The CLI returned no output.' };
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
      env: this.env(),
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
