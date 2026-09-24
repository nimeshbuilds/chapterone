'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { protectUnsavedChanges } = require('../src/main/windowLifecycle');

test('window unload keeps edits by default and on native dialog cancellation', () => {
  for (const result of [0, -1, undefined]) {
    const win = { webContents: new EventEmitter() };
    let allowed = false;
    protectUnsavedChanges(win, { showMessageBoxSync(parent, options) {
      assert.equal(parent, win);
      assert.equal(options.defaultId, 0);
      assert.equal(options.cancelId, 0);
      assert.deepEqual(options.buttons, ['Keep editing', 'Discard changes']);
      return result;
    } });
    win.webContents.emit('will-prevent-unload', { preventDefault() { allowed = true; } });
    assert.equal(allowed, false);
  }
});

test('only explicit discard permits closing a dirty editor', () => {
  const win = { webContents: new EventEmitter() };
  let allowed = false;
  protectUnsavedChanges(win, { showMessageBoxSync: () => 1 });
  win.webContents.emit('will-prevent-unload', { preventDefault() { allowed = true; } });
  assert.equal(allowed, true);
});

test('native dialog errors preserve unsaved edits', () => {
  const win = { webContents: new EventEmitter() };
  let allowed = false;
  protectUnsavedChanges(win, { showMessageBoxSync() { throw new Error('Dialog unavailable'); } });
  assert.doesNotThrow(() => win.webContents.emit('will-prevent-unload', { preventDefault() { allowed = true; } }));
  assert.equal(allowed, false);
});
