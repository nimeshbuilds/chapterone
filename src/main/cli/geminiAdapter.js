'use strict';

const https = require('https');
const { enforceMinWords } = require('./spawn');

const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'; // alias → newest Flash the key can access
const HOST = 'generativelanguage.googleapis.com';

/**
 * Adapter for Google's Gemini, talking to the **Gemini REST API directly** with
 * a Gemini API key.
 *
 * Why not the Gemini CLI? Google retired the CLI's free "Code Assist for
 * individuals" OAuth login, and the CLI now refuses to run even with
 * GEMINI_API_KEY set (it still forces the dead OAuth and throws
 * IneligibleTierError). So we bypass the CLI entirely and call
 * generativelanguage.googleapis.com ourselves — the same approach used for
 * Nano Banana images. Billing is per-token, so the model defaults to a cheap
 * Flash, and we use the "-latest" aliases so the model always resolves to the
 * newest one the key is entitled to.
 */
class GeminiAdapter {
  constructor(config = {}) {
    this.id = 'gemini';
    this.label = 'Gemini API';
    this.model = config.model || DEFAULT_GEMINI_MODEL;
    this.apiKey = (config.apiKey || '').trim();
  }

  /** No CLI to install — "found" means an API key is present. */
  async detect() {
    return this.apiKey ? { found: true, version: 'API key' } : { found: false };
  }

  /** Is `model` a real Gemini model the key can use? Checks the models.list API. */
  async verifyModel(model) {
    if (!this.apiKey) return { valid: null, detail: 'Add a Gemini API key first.' };
    // `-latest` aliases resolve server-side and aren't always in the list.
    if (/-latest$/.test(model)) return { valid: true, detail: 'Valid alias (resolves to the newest model)' };
    const ids = await this._listModels();
    if (!ids.length) return { valid: null, detail: 'Could not read the model list.' };
    return ids.includes(model)
      ? { valid: true, detail: 'Valid Gemini model for your key' }
      : { valid: false, detail: 'Not a model your key can use.' };
  }

  _listModels() {
    return new Promise((resolve) => {
      const req = https.request({ host: HOST, path: `/v1beta/models?key=${encodeURIComponent(this.apiKey)}&pageSize=200`, method: 'GET' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve((j.models || []).map((m) => String(m.name || '').replace(/^models\//, '')));
          } catch (_) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.setTimeout(15000, () => req.destroy());
      req.end();
    });
  }

  async checkAuth() {
    if (!this.apiKey) {
      return { ok: false, detail: 'Add a Gemini API key (aistudio.google.com/apikey) in Settings.' };
    }
    try {
      const text = await this.complete('Reply with exactly the word: READY', { timeoutMs: 60000 });
      return { ok: text.trim().length > 0, detail: text.trim().length ? 'Connected (Gemini API key)' : 'The API returned no text.' };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  async complete(prompt, opts = {}) {
    if (!this.apiKey) throw new Error('No Gemini API key set. Add one in Settings.');
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };

    const out = (await this._stream(body, opts)).trim();
    enforceMinWords(out, opts); // throws on too-short → lets the chain fall back
    return out;
  }

  /** POST streamGenerateContent (SSE) and accumulate the text, emitting deltas. */
  _stream(body, opts = {}) {
    const path = `/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: HOST, path, method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      }, (res) => {
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (c) => { errBody += c; });
          res.on('end', () => reject(new Error(describeError(res.statusCode, errBody, this.model))));
          return;
        }
        let buf = '';
        let full = '';
        res.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const parts = ((((j.candidates || [])[0] || {}).content) || {}).parts || [];
              const t = parts.map((p) => p.text || '').join('');
              if (t) { full += t; if (opts.onStdout) opts.onStdout(t); }
            } catch (_) { /* ignore keep-alive / partial lines */ }
          }
        });
        res.on('end', () => resolve(full));
      });
      req.on('error', reject);
      if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, () => req.destroy(new Error('Gemini request timed out')));
      if (opts.signal) {
        if (opts.signal.aborted) req.destroy(new Error('Aborted'));
        else opts.signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
      }
      req.end(payload);
    });
  }
}

/** Turn an HTTP error from the Gemini API into a clear, actionable message. */
function describeError(status, rawBody, model) {
  let msg = '';
  try { msg = (JSON.parse(rawBody).error || {}).message || ''; } catch (_) { msg = (rawBody || '').slice(0, 200); }
  if (status === 400 && /API[_ ]?key not valid|API_KEY_INVALID/i.test(msg)) return 'Gemini API key is invalid — check it in Settings.';
  if (status === 400 && /not found|not supported|is not found for API version/i.test(msg)) return `The model "${model}" isn't available on this Gemini API key — pick another Gemini model in Settings.`;
  if (status === 401 || status === 403) return 'Gemini API key was rejected (401/403) — check the key in Settings.';
  if (status === 429) return 'Gemini API rate limit / quota exceeded — wait a moment, or check your plan.';
  return `Gemini API error (HTTP ${status})${msg ? ': ' + msg : ''}`;
}

module.exports = { GeminiAdapter, DEFAULT_GEMINI_MODEL, describeError };
