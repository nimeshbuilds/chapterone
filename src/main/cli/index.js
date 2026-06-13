'use strict';

const { ClaudeAdapter } = require('./claudeAdapter');
const { CodexAdapter } = require('./codexAdapter');
const { GeminiAdapter } = require('./geminiAdapter');
const { ChainEngine } = require('./chainEngine');
const { PROVIDER_IDS } = require('./models');

/** Build a single adapter for a provider id from settings. */
function buildAdapter(providerId, settings = {}) {
  const forceSubscription = settings.forceSubscription !== false;
  if (providerId === 'codex') {
    return new CodexAdapter({ command: settings.codexCommand, model: settings.codexModel, extraArgs: settings.codexExtraArgs, forceSubscription });
  }
  if (providerId === 'gemini') {
    return new GeminiAdapter({ command: settings.geminiCommand, model: settings.geminiModel, extraArgs: settings.geminiExtraArgs, forceSubscription });
  }
  return new ClaudeAdapter({ command: settings.claudeCommand, model: settings.claudeModel, extraArgs: settings.claudeExtraArgs, forceSubscription });
}

/** Resolve the ordered list of provider ids for the fallback chain. */
function resolveChain(settings = {}) {
  const primary = settings.provider || 'claude';
  let chain = Array.isArray(settings.chain) && settings.chain.length ? settings.chain.slice() : [primary];
  // Ensure the primary is first, de-dupe, and keep only known providers.
  chain = chain.filter((p) => PROVIDER_IDS.includes(p));
  chain = [primary, ...chain.filter((p) => p !== primary)];
  return [...new Set(chain)];
}

/**
 * Single active adapter (used for clarify/auth probes). Honors a per-book model
 * override on the primary provider.
 */
function createEngine(settings = {}, overrides = {}) {
  const primary = settings.provider || 'claude';
  const s = { ...settings };
  if (overrides.model != null) {
    if (primary === 'codex') s.codexModel = overrides.model;
    else if (primary === 'gemini') s.geminiModel = overrides.model;
    else s.claudeModel = overrides.model;
  }
  return buildAdapter(primary, s);
}

/**
 * The full fallback chain engine used for book generation.
 * @param {object} settings
 * @param {object} [opts] { onSwitch }
 */
function createChainEngine(settings = {}, opts = {}) {
  const ids = resolveChain(settings);
  const adapters = ids.map((id) => buildAdapter(id, settings));
  return new ChainEngine(adapters, { onSwitch: opts.onSwitch });
}

/** Detect every provider's CLI for the prerequisite panel. */
async function checkPrerequisites(settings = {}) {
  const claude = buildAdapter('claude', settings);
  const codex = buildAdapter('codex', settings);
  const gemini = buildAdapter('gemini', settings);
  const [c, x, g] = await Promise.all([claude.detect(), codex.detect(), gemini.detect()]);
  return {
    node: { found: true, version: process.versions.node },
    claude: c, codex: x, gemini: g,
    activeProvider: settings.provider || 'claude',
    chain: resolveChain(settings),
  };
}

module.exports = {
  buildAdapter, resolveChain, createEngine, createChainEngine, checkPrerequisites,
  ClaudeAdapter, CodexAdapter, GeminiAdapter, ChainEngine,
};
