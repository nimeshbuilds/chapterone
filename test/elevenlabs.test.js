'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const el = require('../src/main/book/elevenlabs');

test('model catalog + recommendations', () => {
  assert.strictEqual(el.DEFAULT_MODEL, 'eleven_multilingual_v2');
  assert.ok(el.MODELS.some((m) => m.id === 'eleven_multilingual_v2'));
  assert.ok(Array.isArray(el.RECOMMENDED.adults) && el.RECOMMENDED.adults.length >= 5);
  assert.ok(Array.isArray(el.RECOMMENDED.kids) && el.RECOMMENDED.kids.length >= 5);
});

test('chunkText splits long text at sentence boundaries', () => {
  assert.strictEqual(el.chunkText('Short.').length, 1);
  const chunks = el.chunkText('Sentence here. '.repeat(400)); // ~6000 chars
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 2500));
});

test('annotateRecommended flags matching voices', () => {
  const voices = [{ voice_id: '1', name: 'Adam' }, { voice_id: '2', name: 'Zzz' }];
  const out = el.annotateRecommended(voices, 'adults');
  assert.strictEqual(out.find((v) => v.name === 'Adam').recommended, true);
  assert.strictEqual(out.find((v) => v.name === 'Zzz').recommended, false);
});

test('tts and listVoices validate inputs before any network call', async () => {
  await assert.rejects(el.tts({ voiceId: 'v', text: 'x' }), /API key/);
  await assert.rejects(el.tts({ apiKey: 'k', text: 'x' }), /voice/);
  await assert.rejects(el.tts({ apiKey: 'k', voiceId: 'v', text: '' }), /no text/i);
  await assert.rejects(el.listVoices(''), /API key/);
});

test('cloneVoice validates inputs and builds multipart with samples', async () => {
  await assert.rejects(el.cloneVoice({ name: 'V', samples: [{ buffer: Buffer.from('x') }] }), /API key/);
  await assert.rejects(el.cloneVoice({ apiKey: 'k', samples: [{ buffer: Buffer.from('x') }] }), /name/);
  await assert.rejects(el.cloneVoice({ apiKey: 'k', name: 'V', samples: [] }), /sample/);
  const body = el.buildMultipart({ name: 'V' }, [{ buffer: Buffer.from('AUDIO'), mime: 'audio/webm', filename: 'r.webm' }], 'BOUND');
  const s = body.toString('utf8');
  assert.match(s, /name="name"/);
  assert.match(s, /filename="r\.webm"/);
  assert.match(s, /--BOUND--/);
  assert.match(s, /AUDIO/);
});

test('decodeDataUri tolerates MediaRecorder mime parameters', () => {
  const b64 = Buffer.from('AUDIO').toString('base64');
  // The real bug: MediaRecorder emits "audio/webm;codecs=opus" — the old regex
  // broke on ";codecs=opus" and produced "A voice sample could not be read".
  const webm = el.decodeDataUri(`data:audio/webm;codecs=opus;base64,${b64}`);
  assert.equal(webm.mime, 'audio/webm'); // codecs param stripped for Content-Type
  assert.equal(webm.ext, 'webm');
  assert.equal(webm.buffer.toString('utf8'), 'AUDIO');

  // Uploaded files (m4a/wav/mp3) and plain data URIs still work.
  assert.equal(el.decodeDataUri(`data:audio/mp4;base64,${b64}`).ext, 'm4a');
  assert.equal(el.decodeDataUri(`data:audio/wav;base64,${b64}`).ext, 'wav');
  assert.equal(el.decodeDataUri(`data:audio/mpeg;base64,${b64}`).ext, 'mp3');
  assert.equal(el.decodeDataUri(`data:;base64,${b64}`).mime, 'audio/webm'); // empty mime → default

  // Empty / malformed recordings fail with a clear message, not a crash.
  assert.throws(() => el.decodeDataUri('data:audio/webm;base64,'), /could not be read/);
  assert.throws(() => el.decodeDataUri('not-a-data-uri'), /could not be read/);
});
