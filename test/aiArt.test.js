'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extractSvg, sanitizeSvg, svgToDataUri } = require('../src/main/book/aiArt');

test('extractSvg pulls the svg out of chatter', () => {
  const out = extractSvg('Sure! Here is the cover:\n<svg viewBox="0 0 10 10"><rect/></svg>\nEnjoy.');
  assert.match(out, /^<svg/);
  assert.match(out, /<\/svg>$/);
});

test('sanitizeSvg strips scripts, handlers and external refs', () => {
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">
    <script>alert('x')</script>
    <image href="https://evil.com/x.png"/>
    <a xlink:href="javascript:alert(2)"><rect width="10" height="10" onclick="hack()"/></a>
    <foreignObject><div>hi</div></foreignObject>
    <circle cx="5" cy="5" r="3"/>
  </svg>`;
  const clean = sanitizeSvg(dirty);
  assert.ok(clean);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onload|onclick/i);
  assert.doesNotMatch(clean, /<foreignObject/i);
  assert.doesNotMatch(clean, /<image/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /evil\.com/i);
  assert.match(clean, /<circle/); // legitimate content kept
});

test('sanitizeSvg rejects non-svg input', () => {
  assert.strictEqual(sanitizeSvg('just some text'), null);
  assert.strictEqual(sanitizeSvg('<svg>no viewbox or size</svg>'), null);
});

test('sanitizeSvg injects a namespace if missing', () => {
  const clean = sanitizeSvg('<svg viewBox="0 0 4 4"><rect/></svg>');
  assert.match(clean, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('svgToDataUri produces a base64 svg data uri', () => {
  const uri = svgToDataUri('<svg viewBox="0 0 1 1"></svg>');
  assert.match(uri, /^data:image\/svg\+xml;base64,/);
});
