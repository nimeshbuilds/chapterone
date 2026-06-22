'use strict';

const { ClaudeAdapter } = require('./claudeAdapter');
const { CodexAdapter } = require('./codexAdapter');
const { GeminiAdapter } = require('./geminiAdapter');
const { ChainEngine } = require('./chainEngine');
const { PROVIDER_IDS, PROVIDERS } = require('./models');
const { run, probeVersion } = require('./spawn');

/** Build a single adapter for a provider id from settings. */
function buildAdapter(providerId, settings = {}) {
  const forceSubscription = settings.forceSubscription !== false;
  if (providerId === 'codex') {
    return new CodexAdapter({ command: settings.codexCommand, model: settings.codexModel, extraArgs: settings.codexExtraArgs, forceSubscription });
  }
  if (providerId === 'gemini') {
    // Gemini talks to the REST API directly with a Gemini API key (the CLI's
    // login is dead). Reuse the same key set for Nano Banana — it's one Google key.
    const apiKey = settings.geminiApiKey || (settings.images && settings.images.geminiApiKey) || '';
    return new GeminiAdapter({ model: settings.geminiModel, apiKey });
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

/** Detect whether a usable `npm` is on PATH (needed for one-click installs). */
async function detectNpm() {
  const probe = await probeVersion('npm', ['--version'], 8000);
  return { found: probe.found, version: probe.version, error: probe.error };
}

/** Detect every provider's CLI for the prerequisite panel. */
async function checkPrerequisites(settings = {}) {
  const claude = buildAdapter('claude', settings);
  const codex = buildAdapter('codex', settings);
  const gemini = buildAdapter('gemini', settings);
  const [c, x, g, npm] = await Promise.all([claude.detect(), codex.detect(), gemini.detect(), detectNpm()]);
  return {
    node: { found: true, version: process.versions.node },
    npm,
    claude: c, codex: x, gemini: g,
    activeProvider: settings.provider || 'claude',
    chain: resolveChain(settings),
  };
}

/**
 * Install a provider's CLI globally via npm, streaming output through onLine.
 * Returns the post-install detection result so the UI can confirm success.
 * @param {string} providerId
 * @param {object} [opts] { command, onLine, signal }
 */
async function installProviderCli(providerId, opts = {}) {
  const meta = PROVIDERS[providerId];
  if (!meta || !meta.npmPackage) throw new Error(`No installer is available for "${providerId}".`);
  const onLine = opts.onLine || (() => {});

  const npm = await detectNpm();
  if (!npm.found) {
    throw new Error('npm was not found. Install Node.js (which includes npm) from nodejs.org, then try again.');
  }

  onLine(`$ npm install -g ${meta.npmPackage}\n`);
  const { code, stderr } = await run('npm', ['install', '-g', meta.npmPackage], {
    timeoutMs: 300000,
    signal: opts.signal,
    onStdout: onLine,
    onStderr: onLine,
  });
  if (code !== 0) {
    const hint = /EACCES|permission denied/i.test(stderr)
      ? ' (npm needs write access to its global folder — fix your npm prefix, e.g. `npm config set prefix ~/.npm-global`, or reinstall Node via Homebrew/nvm.)'
      : '';
    throw new Error(`Install failed (exit ${code})${hint}`);
  }
  const found = await (opts.command
    ? probeVersion(opts.command, ['--version'])
    : buildAdapter(providerId, {}).detect());
  onLine(found.found ? `\n✓ Installed: ${found.version || meta.command}\n` : `\n⚠️ Install finished but "${meta.command}" still isn't detected.\n`);
  return found;
}

module.exports = {
  buildAdapter, resolveChain, createEngine, createChainEngine, checkPrerequisites,
  detectNpm, installProviderCli,
  ClaudeAdapter, CodexAdapter, GeminiAdapter, ChainEngine,
};
