'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseImageMarkers,
  pickBestResult,
  extFromContentType,
  mimeForExt,
} = require('../src/main/book/images');

test('parses image-search markers', () => {
  const md = 'Intro.\n\n![A snowy village at dusk](image-search: scottish village snow dusk)\n\nMore text.';
  const markers = parseImageMarkers(md);
  assert.strictEqual(markers.length, 1);
  assert.strictEqual(markers[0].caption, 'A snowy village at dusk');
  assert.strictEqual(markers[0].query, 'scottish village snow dusk');
});

test('ignores normal markdown images', () => {
  assert.strictEqual(parseImageMarkers('![alt](https://x/y.png)').length, 0);
});

test('pickBestResult prefers most permissive license', () => {
  const best = pickBestResult([
    { url: 'a', license: 'by-sa' },
    { url: 'b', license: 'cc0' },
    { url: 'c', license: 'by' },
  ]);
  assert.strictEqual(best.license, 'cc0');
});

test('pickBestResult skips entries without url/license', () => {
  assert.strictEqual(pickBestResult([{ license: 'cc0' }, { url: 'x' }]), null);
  assert.strictEqual(pickBestResult([]), null);
});

test('extFromContentType maps types and falls back to url', () => {
  assert.strictEqual(extFromContentType('image/jpeg'), 'jpg');
  assert.strictEqual(extFromContentType('image/png'), 'png');
  assert.strictEqual(extFromContentType('', 'http://x/y.WEBP?a=1'), 'webp');
  assert.strictEqual(mimeForExt('png'), 'image/png');
});
