'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { svgSize } = require('../src/main/export/rasterize');

test('reads size from viewBox', () => {
  assert.deepStrictEqual(svgSize('<svg viewBox="0 0 1200 1800"></svg>'), { w: 1200, h: 1800 });
  assert.deepStrictEqual(svgSize('<svg viewBox="0,0,640,480"></svg>'), { w: 640, h: 480 });
});

test('falls back to width/height attrs', () => {
  assert.deepStrictEqual(svgSize('<svg width="800" height="600"></svg>'), { w: 800, h: 600 });
});

test('defaults when no size info', () => {
  assert.deepStrictEqual(svgSize('<svg></svg>'), { w: 1200, h: 800 });
});
