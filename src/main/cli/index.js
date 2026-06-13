'use strict';

const { ClaudeAdapter } = require('./claudeAdapter');
const { CodexAdapter } = require('./codexAdapter');

/**
 * Construct the configured engine adapter.
 * @param {object} settings
 * @returns {ClaudeAdapter|CodexAdapter}
 */
function createEngine(settings = {}) {
  const provider = settings.provider || 'claude';
  if (provider === 'codex') {
    return new CodexAdapter({
      command: settings.codexCommand,
      model: settings.codexModel,
      extraArgs: settings.codexExtraArgs,
    });
  }
  return new ClaudeAdapter({
    command: settings.claudeCommand,
    model: settings.claudeModel,
    extraArgs: settings.claudeExtraArgs,
  });
}

/**
 * Run prerequisite checks for both providers so the UI can show status.
 * @param {object} settings
 * @returns {Promise<object>}
 */
async function checkPrerequisites(settings = {}) {
  const claude = new ClaudeAdapter({
    command: settings.claudeCommand,
    model: settings.claudeModel,
  });
  const codex = new CodexAdapter({
    command: settings.codexCommand,
    model: settings.codexModel,
  });

  const [claudeDetect, codexDetect] = await Promise.all([
    claude.detect(),
    codex.detect(),
  ]);

  return {
    node: { found: true, version: process.versions.node },
    claude: claudeDetect,
    codex: codexDetect,
    activeProvider: settings.provider || 'claude',
  };
}

module.exports = { createEngine, checkPrerequisites, ClaudeAdapter, CodexAdapter };
