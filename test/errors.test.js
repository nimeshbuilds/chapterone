'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyError, isResumable, describe } = require('../src/main/book/errors');

test('classifies subscription/credit failures', () => {
  assert.strictEqual(classifyError('You have insufficient credit to continue'), 'subscription');
  assert.strictEqual(classifyError('Usage limit reached for your plan'), 'subscription');
});

test('classifies auth failures', () => {
  assert.strictEqual(classifyError('Error: not logged in, please run claude login'), 'auth');
  assert.strictEqual(classifyError('401 Unauthorized'), 'auth');
});

test('classifies rate limits and network', () => {
  assert.strictEqual(classifyError('429 too many requests'), 'rate_limit');
  assert.strictEqual(classifyError('getaddrinfo ENOTFOUND api'), 'network');
});

test('cancellation and unknown', () => {
  assert.strictEqual(classifyError('Generation cancelled'), 'cancelled');
  assert.strictEqual(classifyError('weird kaboom'), 'unknown');
});

test('resumability + descriptions', () => {
  assert.strictEqual(isResumable('subscription'), true);
  assert.strictEqual(isResumable('network'), true);
  assert.strictEqual(isResumable('cancelled'), false);
  assert.match(describe('subscription'), /reactivate|inactive|credit/i);
});
