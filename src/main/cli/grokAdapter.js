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
    this.model = config.model || ''; // empty => the user's CLI configuration
    this.extraArgs = config.extraArgs || [];
    this.forceSubscription = config.forceSubscription !== false;
  }

  scrub() {
    return this.forceSubscription ? SUBSCRIPTION_SCRUB.grok : [];
  }

  async detect() {
    return probeVersion(this.command, ['--version']);
  }

  /** Parse `grok models` into the list of available model ids. */
  async listModels() {
    const { stdout } = await run(this.command, ['models'], { scrubEnv: this.scrub(), timeoutMs: 30000 });
    const ids = [];
    for (const line of String(stdout || '').split('\n')) {
      const m = line.match(/^\s*[-*]\s*([A-Za-z0-9._-]+)/);
      if (m) ids.push(m[1]);
    }
    return ids;
  }

  /** Is `model` a real Grok model? Checks the live `grok models` list. */
  async verifyModel(model) {
    const ids = await this.listModels();
    if (!ids.length) return { valid: null, detail: 'Could not read Grok’s model list.' };
    return ids.includes(model)
      ? { valid: true, detail: 'Valid Grok model' }
      : { valid: false, detail: `Not a Grok model. Available: ${ids.join(', ')}` };
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
          return { ok: true, detail: 'Cached Grok sign-in found. No text was generated; session validity, model access and billing were not checked.' };
        }
      }
      return { ok: false, detail: 'Not signed in — run “grok login” in Terminal.' };
    } catch (_) {
      return { ok: null, detail: 'Could not read Grok sign-in status. Check the CLI in Terminal. No text was generated.' };
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
    args.push('--tools', opts.ground ? 'WebSearch,WebFetch' : '',
      '--deny', 'Bash', '--deny', 'Edit', '--deny', 'Read', '--deny', 'Grep', '--deny', 'MCPTool',
      '--no-subagents', '--no-memory');
    if (this.model) args.push('--model', this.model);
    // grok-build runs web search as a slow AGENTIC multi-search loop (minutes per
    // call). So we enable search ONLY for explicit grounding calls (opts.ground —
    // e.g. studying the best authors), capping the agent turns so it searches a
    // little then answers. Every other call (chapters, art, recaps) writes from
    // the already-grounded plan with search OFF, so it's a fast single completion.
    const forced = this.extraArgs.some((a) => /web-search/.test(String(a)));
    if (opts.ground && !this.extraArgs.some((a) => /disable-web-search/.test(String(a)))) {
      args.push('--max-turns', '12'); // room to search, then answer (won't loop forever)
    } else if (!forced) {
      args.push('--disable-web-search');
    }
    if (this.extraArgs.length) args.push(...this.extraArgs);
    // Grok-Composer is an agentic model that narrates its plan ("I'll verify the
    // facts, then write the chapter…"). Forbid that so the output is content-only.
    const NO_NARRATION = 'CRITICAL OUTPUT RULE: Respond with ONLY the requested content itself. Do NOT narrate your process, plans, verification, or steps. No preamble, no "I\'ll…", no meta-commentary. Begin immediately with the content.';
    const system = opts.system ? `${opts.system}\n\n${NO_NARRATION}` : NO_NARRATION;
    // Grok has no separate system-prompt flag in headless mode, so fold it in.
    let full = `${system}\n\n${prompt}`;
    // Grok's -p only accepts the prompt as an argument (no stdin mode), and
    // Windows caps the whole command line at ~32K chars. If a huge prompt (the
    // edit pass embeds an entire chapter) would blow that, trim the MIDDLE of
    // the prompt — the instructions live at both ends.
    if (process.platform === 'win32' && full.length > 30000) {
      const keep = 14800;
      full = `${full.slice(0, keep)}\n\n[…middle of the draft omitted for length — keep continuity with what you can see…]\n\n${full.slice(-keep)}`;
    }
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
    if (code !== 0) {
      throw new Error(`Grok CLI exited with code ${code}: ${stderr.trim() || 'no output'}`);
    }
    const out = this.extractFinal(stdout).trim();
    enforceMinWords(out, opts);
    return out;
  }

  /** Strip status/banner lines AND any leading agentic narration/preamble. */
  extractFinal(raw) {
    if (!raw) return '';
    const lines = String(raw).split('\n');
    // Plain output is manuscript content. Strip recognized CLI headers only
    // before the first content line, never dates, scene breaks, or metadata-like
    // prose inside a chapter. The old global filter silently deleted those lines.
    while (lines.length && !lines[0].trim()) lines.shift();
    const hasBanner = /^grok\s*[:=]/i.test(lines[0] || '') || /^Grok (?:Build|CLI)\b/.test(lines[0] || '');
    if (hasBanner) {
      while (lines.length && (!lines[0].trim()
        || /^(grok|model|provider|reasoning|workdir|sandbox|thinking)\s*[:=]/i.test(lines[0].trim())
        || /^Grok (?:Build|CLI)\b/.test(lines[0].trim()))) lines.shift();
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (/^tokens used\s*[:=]\s*[\d,]+\s*$/i.test(lines[lines.length - 1] || '')) lines.pop();
    // Drop leading "I'll verify the facts, then write the chapter…"-style preamble
    // the agentic model emits before the real content. Bounded and conservative:
    // only the first THREE non-empty lines are candidates, each must be short
    // (<220 chars — narration is a sentence, prose paragraphs are long), never a
    // heading, and must BOTH start like planning AND contain a meta keyword — so
    // genuine openers ("First, the sun rose.") and chapter titles survive.
    let i = 0;
    let candidates = 0;
    while (i < lines.length && candidates < 3) {
      const t = lines[i].trim();
      if (!t) { i++; continue; }
      candidates++;
      if (isNarration(t)) { i++; continue; }
      break;
    }
    return lines.slice(i).join('\n').replace(/^\n+/, '');
  }
}

/** True if a line is agentic narration/preamble (planning start + meta keyword). */
function isNarration(line) {
  const raw = String(line).trim();
  if (/^#{1,6}\s/.test(raw)) return false;   // never strip a Markdown heading
  if (raw.length > 220) return false;        // narration is one short sentence
  const t = raw.replace(/^[*_>\s]+/, '');
  if (!t) return false;
  const startsLikePlan = /^(i['’]?ll|i will|i['’]?m|i am|let me|let['’]s|now i|okay[,\s]|sure[,\s]|alright[,\s]|here(?:'s| is) (the|your)|the draft|verifying|writing the|producing|drafting|checking)\b/i.test(t);
  const hasMeta = /\b(verif(y|ying|ied)|writ(e|ing)|produc(e|ing)|draft|drafting|revised|brief|facts|setting details|the full (chapter|poem|book|story|page)|then (write|produce|draft|verify)|sixteen-page|editorial notes)\b/i.test(t);
  return startsLikePlan && hasMeta;
}

module.exports = { GrokAdapter, isNarration };
