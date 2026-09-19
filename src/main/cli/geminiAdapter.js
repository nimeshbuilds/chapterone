'use strict';

const https = require('https');
const { requestBuffer } = require('../http');
const { enforceMinWords } = require('./spawn');

const DEFAULT_GEMINI_MODEL = require('./models').MODEL_PRESETS.gemini.default;
const HOST = 'generativelanguage.googleapis.com';

/**
 * Adapter for Google's Gemini, talking to the **Gemini REST API directly** with
 * a Gemini API key.
 *
 * ChapterOne uses the API integration rather than the separate Gemini CLI.
 * Google login is still supported by Gemini CLI; it is not used here.
 * API usage is billed separately under the user's Google account.
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
    const ids = await this._listModels();
    if (!ids.length) return { valid: null, detail: 'Could not read the model list.' };
    if (ids.includes(model)) return { valid: true, detail: 'Valid Gemini model for your key' };
    // Aliases may be omitted by models.list. Do not falsely verify arbitrary
    // names ending in "-latest", or spend credits on a generation probe.
    if (/-latest$/.test(model)) return { valid: null, detail: 'Alias not listed; availability is checked when generating.' };
    return { valid: false, detail: 'Not a model your key can use.' };
  }

  async _listModels() {
    const { status, buffer } = await requestBuffer({ host: HOST, path: '/v1beta/models?pageSize=1000',
      method: 'GET', headers: { 'x-goog-api-key': this.apiKey },
    }, { timeoutMs: 15000 });
    if (status !== 200) throw new Error(describeError(status, buffer.toString('utf8'), this.model));
    const json = JSON.parse(buffer.toString('utf8'));
    return (json.models || []).map((m) => String(m.name || '').replace(/^models\//, ''));
  }

  async checkAuth() {
    if (!this.apiKey) {
      return { ok: false, detail: 'Add a Gemini API key (aistudio.google.com/apikey) in Settings.' };
    }
    try {
      await this._listModels();
      return { ok: true, detail: 'Connected (Gemini API key; no text generated)' };
    } catch (err) {
      return { ok: false, detail: err.message };
    }
  }

  async complete(prompt, opts = {}) {
    if (!this.apiKey) throw new Error('No Gemini API key set. Add one in Settings.');
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
    if (opts.research) body.tools = [{ google_search: {} }];

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
        host: HOST, path, method: 'POST', signal: opts.signal,
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json', 'Content-Length': payload.length },
      }, (res) => {
        // If the peer drops the socket mid-body (network blip, proxy reset),
        // Node emits 'close'/'aborted' on the response but NOT 'end', and the
        // request 'error' handler does not fire once a response has started —
        // without this, the promise never settles and generation hangs forever.
        // The extra reject after a normal resolve is a harmless no-op.
        res.on('close', () => {
          if (!res.complete) reject(new Error('Gemini connection lost mid-stream — network hiccup, retrying is safe.'));
        });
        res.on('error', (e) => reject(new Error(`Gemini stream error: ${e.message}`)));
        if (res.statusCode !== 200) {
          let errBody = '';
          res.on('data', (c) => { errBody += c; });
          res.on('end', () => reject(new Error(describeError(res.statusCode, errBody, this.model))));
          return;
        }
        res.setEncoding('utf8');
        let buf = '';
        let full = '';
        const readLine = (line) => {
          if (!line.startsWith('data:')) return;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') return;
          let j;
          try { j = JSON.parse(data); } catch (_) { return; }
          const parts = j?.candidates?.[0]?.content?.parts;
          if (!Array.isArray(parts)) return;
          const t = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
          if (t) { full += t; if (opts.onStdout) opts.onStdout(t); }
        };
        res.on('data', (chunk) => {
          buf += chunk;
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            readLine(line);
          }
        });
        res.on('end', () => { readLine(buf.trim()); resolve(full); });
      });
      req.on('error', reject);
      if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, () => req.destroy(new Error('Gemini request timed out')));
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
