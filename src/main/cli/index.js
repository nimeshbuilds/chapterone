'use strict';

const { ClaudeAdapter } = require('./claudeAdapter');
const { CodexAdapter } = require('./codexAdapter');

/**
 * Construct the configured engine adapter.
 * @param {object} settings
 * @param {object} [overrides]  e.g. { model } to override per-book.
 */
function createEngine(settings = {}, overrides = {}) {
  const provider = settings.provider || 'claude';
  const forceSubscription = settings.forceSubscription !== false;
  if (provider === 'codex') {
    return new CodexAdapter({
      command: settings.codexCommand,
      model: overrides.model != null ? overrides.model : settings.codexModel,
      extraArgs: settings.codexExtraArgs,
      forceSubscription,
    });
  }
  return new ClaudeAdapter({
    command: settings.claudeCommand,
    model: overrides.model != null ? overrides.model : settings.claudeModel,
    extraArgs: settings.claudeExtraArgs,
    forceSubscription,
  });
}

/** Run prerequisite checks for both providers so the UI can show status. */
async function checkPrerequisites(settings = {}) {
  const claude = new ClaudeAdapter({ command: settings.claudeCommand });
  const codex = new CodexAdapter({ command: settings.codexCommand });
  const [claudeDetect, codexDetect] = await Promise.all([claude.detect(), codex.detect()]);
  return {
    node: { found: true, version: process.versions.node },
    claude: claudeDetect,
    codex: codexDetect,
    activeProvider: settings.provider || 'claude',
  };
}

module.exports = { createEngine, checkPrerequisites, ClaudeAdapter, CodexAdapter };
