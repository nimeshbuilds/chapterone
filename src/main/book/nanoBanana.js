'use strict';

const { requestBuffer } = require('../http');

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
  { id: 'gemini-2.5-flash-image', label: 'Nano Banana — recommended', price: 0.039 },
  { id: 'gemini-3-pro-image', label: 'Nano Banana Pro — best quality', price: 0.134 },
];
const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
const HOST = 'generativelanguage.googleapis.com';
const API_VERSION = 'v1beta'; // image generation (responseModalities) requires v1beta

/** Per-image USD price for a model id (for cost estimates). */
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
  if (status === 404) return `That image model isn't available on your key (404). Pick a different model in Settings → AI Illustrations (try “Nano Banana — recommended”).${msg ? ` ${msg}` : ''}`;
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

  // Aspect ratio is expressed in the prompt (the v1beta image API has no body
  // field for it on all models). The body uses ONLY the documented field
  // responseModalities on generationConfig (no other config field is valid).
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
