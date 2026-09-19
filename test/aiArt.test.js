'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { extractSvg, sanitizeSvg, svgToDataUri, extractHtmlArt, sanitizeHtml } = require('../src/main/book/aiArt');

test('extractHtmlArt pulls the fragment out of fenced chatter', () => {
  const out = extractHtmlArt('Here you go:\n```html\n<div class="art"><svg></svg></div>\n```\nDone.');
  assert.match(out, /^<div/);
  assert.match(out, /<\/div>$/);
});

test('sanitizeHtml strips scripts, frames, handlers and external refs but keeps CSS+SVG', () => {
  const dirty = '<div onclick="hack()"><style>.a{background:url(https://evil/x.png)}@import url(//evil/y.css);}</style>'
    + '<script>steal()</script><iframe src="//evil"></iframe><img src="https://evil/t.png">'
    + '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#39f"/></svg>🌟</div>';
  const clean = sanitizeHtml(dirty);
  assert.ok(clean);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /<iframe/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /@import/i);
  assert.doesNotMatch(clean, /url\(\s*['"]?https?:/i);     // external CSS url neutralized
  assert.doesNotMatch(clean, /src="https?:/i);            // external img neutralized
  assert.match(clean, /<svg/);                            // inline SVG kept
  assert.match(clean, /🌟/);                              // emoji kept
});

test('sanitizeHtml rejects non-markup input', () => {
  assert.strictEqual(sanitizeHtml('just plain text'), null);
  assert.strictEqual(sanitizeHtml(''), null);
});

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

test('SVG exports reject obfuscated resources, unquoted handlers and animated links', () => {
  const dirty = '<svg viewBox="0 0 20 20" onload=alert(1)>'
    + '<use href="&#x6a;avascript:alert(1)"/><use href="file:///private/book"/>'
    + '<set attributeName="href" to="https://evil.test"/>'
    + '<rect fill="url(https://evil.test)" style="fill:url(https://evil.test);stroke:#abc"/>'
    + '<style>@import "https://evil.test";</style>'
    + '<defs><linearGradient id="good"><stop stop-color="#fff"/></linearGradient></defs>'
    + '<rect fill="url(#good)"/><use href="#good"/></svg>';
  const clean = sanitizeSvg(dirty);
  assert.doesNotMatch(clean, /onload|javascript:|file:|evil|<set|<style/);
  assert.match(clean, /fill="url\(#good\)"/);
  assert.match(clean, /<linearGradient/);
  assert.match(clean, /stroke:#abc/);
  const embedded = Buffer.from(svgToDataUri(dirty).split(',')[1], 'base64').toString();
  assert.doesNotMatch(embedded, /onload|javascript:|file:|evil/);
});
