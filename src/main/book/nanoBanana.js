'use strict';

const { requestBuffer } = require('../http');

/**
 * Google "Nano Banana" image generation via the Gemini API.
 *
 * Image generation is opt-in and billed through the user's Gemini API key.
 * The Gemini writing engine can share this key; subscription CLIs never receive it.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */

const IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 — recommended', price: 0.067 },
  { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite — fastest & lowest cost', price: 0.0336,
    note: 'Best for simple images. For multiple character reference photos and consistency across pages, choose Nano Banana 2 or Pro.' },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro — complex artwork', price: 0.134 },
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana — legacy', price: 0.039,
    note: 'Google will shut down this model on October 2, 2026. Choose Nano Banana 2 or 2 Lite.' },
];
const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
const HOST = 'generativelanguage.googleapis.com';
const API_VERSION = 'v1beta'; // retain compatibility with existing generateContent integrations

/** Approximate standard 1K image-output USD price; input/thinking billed separately. */
function priceFor(modelId) {
  const m = IMAGE_MODELS.find((x) => x.id === modelId);
  return m ? m.price : 0.134;
}
function modelLabel(modelId) {
  const m = IMAGE_MODELS.find((x) => x.id === modelId);
  return m ? m.label : modelId;
}

async function postJson(path, apiKey, body, signal) {
  const payload = Buffer.from(JSON.stringify(body));
  const result = await requestBuffer({ host: HOST, path, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-goog-api-key': apiKey },
  }, { body: payload, signal });
  return { status: result.status, body: result.buffer.toString('utf8') };
}

/** Turn an API error body into a friendly message. */
function describeError(status, bodyText) {
  let msg = '';
  try { msg = JSON.parse(bodyText).error?.message || ''; } catch (_) { msg = (bodyText || '').slice(0, 200); }
  if (status === 400) return `Nano Banana rejected the request (400): ${msg || 'bad request'}`;
  if (status === 401 || status === 403) return `Your Gemini API key was rejected (${status}). Check the key in Settings → AI Illustrations.${msg ? ` ${msg}` : ''}`;
  if (status === 404) return `That image model isn't available on your key (404). Pick a different model in Settings → AI Illustrations (try “Nano Banana 2 — recommended”).${msg ? ` ${msg}` : ''}`;
  if (status === 429) return 'Nano Banana rate/quota limit hit (429). Wait a moment or check your Google AI Studio quota.';
  return `Nano Banana error ${status}: ${msg || 'unknown'}`;
}

/** Extract the first inline image part from a generateContent response. */
function extractImage(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (p.thought) continue; // Gemini 3 can return interim composition images.
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

  // Keep the shared generateContent request compatible with saved legacy models.
  // New models also support imageConfig; use their default 1K size here.
  const aspectHint = opts.aspectRatio ? `Compose this as a ${opts.aspectRatio} aspect ratio image. ` : '';
  // Optional reference photos (e.g. a child's uploaded picture) so the model
  // draws a character that RESEMBLES them, in the book's art style. Sent as
  // inline image parts before the text; capped to keep the request small.
  const parts = [];
  for (const ref of (opts.referenceImages || []).slice(0, 4)) {
    if (ref && ref.data) parts.push({ inline_data: { mime_type: ref.mime || 'image/jpeg', data: ref.data } });
  }
  parts.push({ text: aspectHint + opts.prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  };

  const { status, body: text } = await postJson(`/${API_VERSION}/models/${encodeURIComponent(model)}:generateContent`, apiKey, body, opts.signal);
  if (status !== 200) throw new Error(describeError(status, text));

  let json;
  try { json = JSON.parse(text); } catch (_) { throw new Error('Nano Banana returned an unreadable response.'); }
  const img = extractImage(json);
  if (!img) throw new Error('Nano Banana returned no image (the prompt may have been blocked by safety filters).');
  const ext = img.mime.includes('jpeg') ? 'jpg' : img.mime.includes('webp') ? 'webp' : 'png';
  return { ...img, ext };
}

/** Check model access without generating a billable image. */
async function verifyKey(apiKey, model) {
  if (!apiKey || !apiKey.trim()) throw new Error('Add a Gemini API key first.');
  const { status, buffer } = await requestBuffer({ host: HOST,
    path: `/${API_VERSION}/models/${encodeURIComponent(model || DEFAULT_IMAGE_MODEL)}`,
    method: 'GET', headers: { 'x-goog-api-key': apiKey.trim() },
  }, { timeoutMs: 30000 });
  if (status !== 200) throw new Error(describeError(status, buffer.toString('utf8')));
  return { ok: true };
}

module.exports = {
  IMAGE_MODELS, DEFAULT_IMAGE_MODEL,
  generateImage, verifyKey, priceFor, modelLabel,
};
