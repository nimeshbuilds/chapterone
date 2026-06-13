'use strict';

const https = require('https');

/**
 * Google "Nano Banana" image generation via the Gemini API.
 *
 * Unlike the text engines (which run on the user's CLI subscription, never an
 * API key), the image models are NOT available through any CLI — so image
 * generation is an explicit, opt-in feature that uses a Gemini API key the user
 * provides. This key is used ONLY for image calls to Google; it never touches
 * text generation and is never injected into the CLI child environment.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */

const IMAGE_MODELS = [
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro — best quality', price: 0.134 },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana — faster / cheaper', price: 0.039 },
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 — fast', price: 0.06 },
];
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image';
const HOST = 'generativelanguage.googleapis.com';

/** Per-image USD price for a model id (for cost estimates). */
function priceFor(modelId) {
  const m = IMAGE_MODELS.find((x) => x.id === modelId);
  return m ? m.price : 0.134;
}
function modelLabel(modelId) {
  const m = IMAGE_MODELS.find((x) => x.id === modelId);
  return m ? m.label : modelId;
}

function postJson(path, apiKey, body, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('Aborted before start'));
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        host: HOST,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          'x-goog-api-key': apiKey,
        },
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Image request timed out')); });
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('Aborted')), { once: true });
    req.write(payload);
    req.end();
  });
}

/** Turn an API error body into a friendly message. */
function describeError(status, bodyText) {
  let msg = '';
  try { msg = JSON.parse(bodyText).error?.message || ''; } catch (_) { msg = (bodyText || '').slice(0, 200); }
  if (status === 400) return `Nano Banana rejected the request (400): ${msg || 'bad request'}`;
  if (status === 401 || status === 403) return `Your Gemini API key was rejected (${status}). Check the key in Settings → AI Illustrations.${msg ? ` ${msg}` : ''}`;
  if (status === 429) return 'Nano Banana rate/quota limit hit (429). Wait a moment or check your Google AI Studio quota.';
  return `Nano Banana error ${status}: ${msg || 'unknown'}`;
}

/** Extract the first inline image part from a generateContent response. */
function extractImage(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const inline = p.inline_data || p.inlineData;
    if (inline && inline.data) {
      const mime = inline.mime_type || inline.mimeType || 'image/png';
      return { buffer: Buffer.from(inline.data, 'base64'), mime };
    }
  }
  return null;
}

/**
 * Generate one image. Returns { buffer, mime, ext }.
 * @param {object} opts { apiKey, model, prompt, aspectRatio, size, signal }
 */
async function generateImage(opts = {}) {
  const apiKey = (opts.apiKey || '').trim();
  if (!apiKey) throw new Error('No Gemini API key set. Add one in Settings → AI Illustrations to use Nano Banana.');
  const model = opts.model || DEFAULT_IMAGE_MODEL;
  if (!opts.prompt || !opts.prompt.trim()) throw new Error('An image prompt is required.');

  const body = {
    contents: [{ parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      responseFormat: { image: { aspectRatio: opts.aspectRatio || '1:1', imageSize: opts.size || '1K' } },
    },
  };

  const { status, body: text } = await postJson(`/v1/models/${model}:generateContent`, apiKey, body, opts.signal);
  if (status !== 200) throw new Error(describeError(status, text));

  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('Nano Banana returned an unreadable response.'); }
  const img = extractImage(json);
  if (!img) throw new Error('Nano Banana returned no image (the prompt may have been blocked by safety filters).');
  const ext = img.mime.includes('jpeg') ? 'jpg' : img.mime.includes('webp') ? 'webp' : 'png';
  return { ...img, ext };
}

/** Lightweight key check: try a tiny generation; resolve {ok} or throw. */
async function verifyKey(apiKey, model) {
  await generateImage({ apiKey, model: model || DEFAULT_IMAGE_MODEL, prompt: 'A small flat-style smiling sun icon, minimal.', size: '512' });
  return { ok: true };
}

module.exports = {
  IMAGE_MODELS, DEFAULT_IMAGE_MODEL,
  generateImage, verifyKey, priceFor, modelLabel,
};
