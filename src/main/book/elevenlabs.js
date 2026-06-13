'use strict';

const https = require('https');

/**
 * ElevenLabs text-to-speech for the optional audiobook feature.
 *
 * Like Nano Banana, this is an explicit opt-in that uses an API key the user
 * provides (audio-only). The key is never used for text generation and never
 * injected into the CLI child environment. Docs: https://elevenlabs.io/docs
 */

const HOST = 'api.elevenlabs.io';

const MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2 — best for audiobooks' },
  { id: 'eleven_v3', label: 'v3 — most expressive (newest)' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5 — fast & low-cost' },
];
const DEFAULT_MODEL = 'eleven_multilingual_v2';

/**
 * Researched shortlists of the best narrator voices to surface first. These are
 * matched by name against whatever voices the user's account actually has, so
 * the selectable IDs are always valid.
 */
const RECOMMENDED = {
  adults: ['Bill L. Oxley', 'David', 'British Storyteller', 'Amelia', 'Adam', 'Bella', 'Brian', 'George', 'Daniel'],
  kids: ['Lily', 'Matilda', 'Charlotte', 'Alice', 'Sarah', 'Grandpa', 'Hope', 'Freya'],
};

const MAX_CHUNK = 2500; // characters per TTS request (safe across models)

function httpGet(path, apiKey, signal) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path, method: 'GET', headers: { 'xi-api-key': apiKey, Accept: 'application/json' }, timeout: 30000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('ElevenLabs request timed out')));
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
    req.end();
  });
}

function httpPostAudio(path, apiKey, body, signal) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request({
      host: HOST, path, method: 'POST', timeout: 180000,
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('ElevenLabs request timed out')));
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
    req.write(payload);
    req.end();
  });
}

function describeError(status, bodyText) {
  let msg = '';
  try { msg = JSON.parse(bodyText).detail?.message || JSON.parse(bodyText).detail || ''; } catch (_) { msg = (bodyText || '').slice(0, 200); }
  if (status === 401) return 'Your ElevenLabs API key was rejected (401). Check it in Settings → Audiobook.';
  if (status === 429) return 'ElevenLabs rate/quota limit hit (429). You may be out of characters for the month.';
  return `ElevenLabs error ${status}: ${msg || 'unknown'}`;
}

/** List the voices on the user's account. */
async function listVoices(apiKey, signal) {
  if (!apiKey || !apiKey.trim()) throw new Error('No ElevenLabs API key set. Add one in Settings → Audiobook.');
  const { status, body } = await httpGet('/v1/voices', apiKey.trim(), signal);
  if (status !== 200) throw new Error(describeError(status, body));
  let json;
  try { json = JSON.parse(body); } catch (_) { throw new Error('ElevenLabs returned an unreadable voice list.'); }
  return (json.voices || []).map((v) => ({
    voice_id: v.voice_id, name: v.name, category: v.category || '',
    labels: v.labels || {}, preview_url: v.preview_url || '',
  }));
}

/** Tag voices that match a recommended shortlist (for nice grouping in the UI). */
function annotateRecommended(voices, which = 'adults') {
  const names = (RECOMMENDED[which] || []).map((n) => n.toLowerCase());
  return voices.map((v) => ({ ...v, recommended: names.some((n) => (v.name || '').toLowerCase().includes(n)) }));
}

/** Split long text into <=MAX_CHUNK pieces at sentence boundaries. */
function chunkText(text, max = MAX_CHUNK) {
  const clean = String(text || '').trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [clean];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > max) { // a single very long sentence: hard-split
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

/**
 * Synthesize speech for `text`. Long text is chunked and the MP3 parts are
 * concatenated. Returns { buffer, mime:'audio/mpeg', chars }.
 */
async function tts(opts = {}) {
  const apiKey = (opts.apiKey || '').trim();
  if (!apiKey) throw new Error('No ElevenLabs API key set. Add one in Settings → Audiobook.');
  if (!opts.voiceId) throw new Error('Pick a narration voice in Settings → Audiobook first.');
  const text = String(opts.text || '').trim();
  if (!text) throw new Error('There is no text to narrate yet.');
  const modelId = opts.modelId || DEFAULT_MODEL;

  const chunks = chunkText(text);
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const parts = [];
  onProgress({ done: 0, total: chunks.length });
  for (let i = 0; i < chunks.length; i++) {
    const { status, buffer } = await httpPostAudio(
      `/v1/text-to-speech/${opts.voiceId}`,
      apiKey,
      { text: chunks[i], model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true } },
      opts.signal
    );
    if (status !== 200) throw new Error(describeError(status, buffer.toString('utf8')));
    parts.push(buffer);
    onProgress({ done: i + 1, total: chunks.length });
  }
  return { buffer: Buffer.concat(parts), mime: 'audio/mpeg', chars: text.length };
}

/** Validate a key by listing voices. */
async function verifyKey(apiKey) {
  const voices = await listVoices(apiKey);
  return { ok: true, count: voices.length };
}

// ---- Instant Voice Cloning ----

/** Build a multipart/form-data body from string fields + audio file parts. */
function buildMultipart(fields, files, boundary) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
    parts.push(f.buffer);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function httpPostRaw(path, apiKey, body, contentType, signal) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, path, method: 'POST', timeout: 180000,
      headers: { 'xi-api-key': apiKey, 'Content-Type': contentType, 'Content-Length': body.length, Accept: 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('ElevenLabs request timed out')));
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
    req.write(body);
    req.end();
  });
}

/**
 * Create an Instant Voice Clone from one or more audio samples of the user.
 * @param {object} opts { apiKey, name, samples:[{buffer, mime, filename}], signal }
 * @returns {Promise<{voice_id, name}>}
 */
async function cloneVoice(opts = {}) {
  const apiKey = (opts.apiKey || '').trim();
  if (!apiKey) throw new Error('No ElevenLabs API key set. Add one in Settings → Audiobook.');
  const name = (opts.name || '').trim();
  if (!name) throw new Error('Give your voice a name first.');
  const samples = (opts.samples || []).filter((s) => s && s.buffer && s.buffer.length);
  if (!samples.length) throw new Error('Record or upload at least one voice sample first.');

  const boundary = '----ChapterOneVoice' + Buffer.from(name).toString('hex').slice(0, 8) + samples[0].buffer.length;
  const body = buildMultipart(
    { name, description: 'Personal voice cloned in ChapterOne', remove_background_noise: 'true' },
    samples,
    boundary
  );
  const { status, body: text } = await httpPostRaw('/v1/voices/add', apiKey, body, `multipart/form-data; boundary=${boundary}`, opts.signal);
  if (status !== 200) {
    // 403 here usually means the plan doesn't include voice cloning.
    if (status === 403) throw new Error('Voice cloning needs an ElevenLabs paid plan (Starter or above). ' + describeError(status, text));
    throw new Error(describeError(status, text));
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('ElevenLabs returned an unreadable response to the clone request.'); }
  if (!json.voice_id) throw new Error('Cloning did not return a voice id.');
  return { voice_id: json.voice_id, name };
}

module.exports = { MODELS, DEFAULT_MODEL, RECOMMENDED, listVoices, annotateRecommended, chunkText, tts, verifyKey, cloneVoice, buildMultipart };
