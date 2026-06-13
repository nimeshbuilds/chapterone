'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseImageMarkers,
  pickBestResult,
  scoreResult,
  meetsQualityBar,
  queryTerms,
  extFromContentType,
  mimeForExt,
  MIN_WIDTH,
  MIN_HEIGHT,
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

test('meetsQualityBar rejects small images, allows large/unknown', () => {
  assert.strictEqual(meetsQualityBar({ width: 400, height: 300 }), false);
  assert.strictEqual(meetsQualityBar({ width: MIN_WIDTH + 50, height: MIN_HEIGHT + 50 }), true);
  assert.strictEqual(meetsQualityBar({ /* unknown dims */ }), true);
});

test('queryTerms drops short/noise tokens', () => {
  assert.deepStrictEqual(queryTerms('A snowy Scottish village'), ['snowy', 'scottish', 'village']);
});

test('relevant high-res image beats irrelevant tiny one of same license', () => {
  const results = [
    { url: 'tiny', license: 'cc0', title: 'random cat', width: 500, height: 400, tags: [] },
    { url: 'big', license: 'cc0', title: 'scottish village in snow', width: 3000, height: 2000, tags: [{ name: 'snow' }] },
  ];
  assert.strictEqual(pickBestResult(results, 'scottish village snow').url, 'big');
});

test('a relevant high-res CC-BY image can outrank an irrelevant tiny CC0', () => {
  const results = [
    { url: 'cc0tiny', license: 'cc0', title: 'unrelated object', width: 400, height: 300, tags: [] },
    { url: 'bylarge', license: 'by', title: 'venice canal at sunrise', width: 4000, height: 2600, tags: [{ name: 'venice' }, { name: 'canal' }] },
  ];
  assert.strictEqual(pickBestResult(results, 'venice canal sunrise').url, 'bylarge');
});

test('scoreResult rewards relevance and resolution', () => {
  const terms = queryTerms('mountain lake');
  const strong = scoreResult({ license: 'cc0', title: 'mountain lake reflection', width: 3000, height: 2000, tags: [] }, terms, 0, 2);
  const weak = scoreResult({ license: 'cc0', title: 'city street', width: 800, height: 600, tags: [] }, terms, 1, 2);
  assert.ok(strong > weak);
});

test('extFromContentType maps types and falls back to url', () => {
  assert.strictEqual(extFromContentType('image/jpeg'), 'jpg');
  assert.strictEqual(extFromContentType('image/png'), 'png');
  assert.strictEqual(extFromContentType('', 'http://x/y.WEBP?a=1'), 'webp');
  assert.strictEqual(mimeForExt('png'), 'image/png');
});
