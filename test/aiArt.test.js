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
  assert.equal(clean.toLowerCase().includes('evil.com'), false);
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

test('hybrid artwork uses a parser allowlist for malformed tags and event attributes', () => {
  const { Parser } = require('htmlparser2');
  const attacks = [
    '<div><script>bad()</script ><p>Visible</p></div>',
    '<div><scr<script>ipt>bad()</scr<script>ipt><p>Visible</p></div>',
    '<DIV ONCLICK=bad()><SCRIPT>bad()</SCRIPT ><p onpointerenter=bad()>Visible</p></DIV>',
    '<DIV><STYLE>.safe{color:#123} @import "https://evil.test";</STYLE><P>Visible</P></DIV>',
    '<div><!--><img src=x onerror=bad()>--><p>Visible</p></div>',
    '<div><template><iframe src="file:///private"></iframe></template><p>Visible</p></div>',
    '<div><svg><foreignObject><textarea><img src=x onerror=bad()></textarea></foreignObject></svg></div>',
    '<div><svg><style><img src=x onerror=bad()></style></svg><p>Visible</p></div>',
  ];
  for (const attack of attacks) {
    const clean = sanitizeHtml(attack);
    assert.ok(clean, attack);
    const forbidden = new Set(['script', 'iframe', 'object', 'embed', 'foreignobject', 'template', 'textarea', 'xmp']);
    const parser = new Parser({ onopentag(name, attrs) {
      assert.equal(forbidden.has(name), false, clean);
      assert.ok(Object.keys(attrs).every((key) => !key.startsWith('on')), clean);
    } });
    parser.end(clean);
    assert.equal(sanitizeHtml(clean), clean, 'a second parse must not reveal new markup');
  }
});

test('hybrid artwork rejects encoded resource attributes and SVG data documents', () => {
  const dirty = '<div><img src="&#x68;ttps://evil.test/pixel" srcset="https://evil.test/two 2x">'
    + '<img src="file:///private/book"><img src="data:image/svg+xml;base64,PHN2Zz4=">'
    + '<img src="data:image/png;base64,YQ==" alt="Safe raster">'
    + '<svg viewBox="0 0 20 20"><use href="&#x6a;avascript:bad()"/>'
    + '<use href="&#102;ile:///private/book"/><use href="#local"/>'
    + '<rect fill="url(https://evil.test/paint)"/><circle id="local" r="3"/></svg></div>';
  const clean = sanitizeHtml(dirty);
  assert.equal(clean.includes('evil.test'), false);
  assert.doesNotMatch(clean, /javascript:|file:|srcset|image\/svg/);
  assert.match(clean, /data:image\/png;base64,YQ==/);
  assert.match(clean, /href="#local"/);
});

test('hybrid artwork retains static CSS layouts, gradients and inline SVG definitions', () => {
  const clean = sanitizeHtml('<style>.cover{display:grid;grid-template-columns:1fr 1fr;'
    + 'background:linear-gradient(135deg,#123,#456);padding:24px}.sun{filter:blur(2px)}</style>'
    + '<div class="cover" style="position:relative;width:1200px;height:1800px;font-family:Georgia;color:#fff">'
    + '<svg viewBox="0 0 100 100"><defs><linearGradient id="sun"><stop offset="0" stop-color="#fff"/>'
    + '<stop offset="1" stop-color="#fc0"/></linearGradient></defs>'
    + '<circle cx="50" cy="50" r="20" fill="url(#sun)" style="fill:url(#sun);stroke:#abc"/></svg>'
    + '<h1>Across the River</h1></div>');
  assert.match(clean, /<style>/);
  assert.match(clean, /display:grid/);
  assert.match(clean, /linear-gradient\(135deg,#123,#456\)/);
  assert.match(clean, /filter:blur\(2px\)/);
  assert.match(clean, /<linearGradient id="sun">/);
  assert.match(clean, /viewBox="0 0 100 100"/);
  assert.match(clean, /fill="url\(#sun\)"/);
  assert.match(clean, /style="fill:url\(#sun\);stroke:#abc"/);
});

test('hybrid CSS drops imports, escaped resource functions and encoded inline URLs', () => {
  const dirty = '<style>@import "https://evil.test/import";'
    + '@font-face{font-family:bad;src:url(https://evil.test/font)}'
    + '.a{background:u\\72l(https://evil.test/escaped);color:#123}'
    + '.b{background-image:image-set("https://evil.test/set" 1x);width:100px}'
    + '.c{--image:url(https://evil.test/var);background:var(--image)}'
    + '.d{background:u/**/rl(https://evil.test/comment);behavior:url(https://evil.test/legacy)}'
    + '.e{background-image:src("https://evil.test/unknown-resource-function")}'
    + '</style><div style="background:&#117;rl(https://evil.test/inline);color:#abc">Safe</div>';
  const clean = sanitizeHtml(dirty);
  assert.equal(clean.includes('evil.test'), false);
  assert.doesNotMatch(clean, /@import|@font-face|image-set|behavior/);
  assert.match(clean, /color:#123/);
  assert.match(clean, /width:100px/);
  assert.match(clean, /style="color:#abc"/);
});

test('unparseable CSS fails closed without discarding valid artwork markup', () => {
  const clean = sanitizeHtml('<style>.a{background:url(https://evil.test/bad)</style>'
    + '<div style="color:red}body{background:url(https://evil.test/injected)">Safe</div>');
  assert.equal(clean.includes('evil.test'), false);
  assert.doesNotMatch(clean, /<style|style=/);
  assert.match(clean, /<div>Safe<\/div>/);
});
