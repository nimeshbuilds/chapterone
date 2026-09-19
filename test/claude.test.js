'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClaudeAdapter } = require('../src/main/cli/claudeAdapter');

test('Claude removes built-in tools for text and restricts research to web tools', () => {
  for (const research of [false, true]) {
    const args = new ClaudeAdapter().buildArgs({ research });
    assert.equal(args[args.indexOf('--tools') + 1], research ? 'WebSearch,WebFetch' : '');
    assert.ok(args.includes('--strict-mcp-config'));
  }
});
