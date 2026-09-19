'use strict';

/**
 * Provider catalog. Claude, Codex and Grok use provider CLIs; Gemini uses its
 * separately billed REST API. Availability depends on the user's provider account.
 */

// Reviewed against official provider documentation. See docs/MODELS.md for
// sources and the update checklist. CLI defaults honor the user's configuration;
// neither a default nor an alias guarantees account access to the newest model.
const CATALOG_REVIEWED_AT = '2026-09-19';
const CLAUDE_MODELS = [
  { id: '', label: 'CLI default — uses your configuration' },
  { id: 'fable', label: 'Claude Fable — latest alias', note: 'Requires a recent Claude Code and account access. Depending on your plan, Fable can bill usage credits. ChapterOne uses headless mode, where Claude Code does not ask for billing confirmation.' },
  { id: 'opus', label: 'Claude Opus — latest alias, quality' },
  { id: 'sonnet', label: 'Claude Sonnet — latest alias, balanced' },
  { id: 'haiku', label: 'Claude Haiku — latest alias, fast' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 — pinned', note: 'Requires Claude Code 2.1.257 or later and account access. Depending on your plan, headless requests can bill usage credits without a confirmation prompt.' },
  { id: 'claude-opus-5', label: 'Claude Opus 5 — pinned', note: 'Requires Claude Code 2.1.219 or later and provider/account access.' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — pinned', note: 'Requires Claude Code 2.1.197 or later and provider/account access.' },
];

const CODEX_MODELS = [
  { id: '', label: 'CLI default — uses your configuration' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra — most capable', note: 'Availability depends on your plan, rollout, and Codex version. Uses more quota than the smaller choices.' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — complex writing & reasoning' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — balanced' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — fast & economical' },
  { id: 'gpt-5.5', label: 'GPT-5.5 — legacy' },
];

// Gemini uses separately billed REST calls. Google controls alias targets,
// which may point to stable, preview, or experimental releases.
const GEMINI_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash — latest alias', note: 'Google updates this alias automatically; it can point to a stable, preview, or experimental release. Choose a pinned version for predictable behavior.' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — latest stable Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite — fast & economical' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — preview', note: 'Preview model: availability and behavior can change before a stable release.' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — older pinned version' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — older pinned version' },
];

// Only advertise documented CLI choices. API-only models are not necessarily
// available through subscription login. Custom IDs can be checked via `grok models`.
const GROK_MODELS = [
  { id: '', label: 'CLI default — uses your configuration' },
  { id: 'grok-build', label: 'Grok Build — current CLI alias' },
];

// Preserve quality/speed tiers. Grok has no separately verified fast CLI alias;
// its Fast preset leaves model selection to the user's CLI configuration.
const MODEL_PRESETS = {
  claude: { fast: 'haiku', pro: 'opus', default: '' },
  codex: { fast: 'gpt-5.6-luna', pro: 'gpt-5.6-sol', default: '' },
  gemini: { fast: 'gemini-3.5-flash-lite', pro: 'gemini-3.1-pro-preview', default: 'gemini-flash-latest' },
  grok: { fast: '', pro: 'grok-build', default: '' },
};

// Saved pins remain intact, including IDs absent from the current catalog.
const MODEL_NOTICES = {
  codex: {
    'gpt-5.4': 'Retired from Codex with ChatGPT sign-in on August 31, 2026. Choose GPT-5.6 Terra or CLI default. API-key access is separate.',
    'gpt-5.4-mini': 'Retired from Codex with ChatGPT sign-in on August 31, 2026. Choose GPT-5.6 Luna or CLI default. API-key access is separate.',
    'gpt-5.5': 'Scheduled to retire from Codex with ChatGPT sign-in on October 14, 2026. Choose GPT-5.6 Sol or CLI default. API-key access is separate.',
  },
  grok: {
    'grok-composer-2.5-fast': 'This saved model is no longer a recommended CLI choice. Use Check model to query your CLI, or choose Grok Build / CLI default.',
  },
};

/** The model id for a provider's preset ('fast' | 'pro' | 'default'). */
function presetModel(provider, preset) {
  const p = MODEL_PRESETS[provider];
  if (!p) return '';
  return p[preset] != null ? p[preset] : (p.default || '');
}

/** Env vars that force API-key billing; stripped so the CLI uses the
 * subscription login instead. */
const SUBSCRIPTION_SCRUB = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'OPENAI_API_BASE'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'],
  grok: ['XAI_API_KEY', 'GROK_CODE_XAI_API_KEY'],
};

/**
 * Per-provider metadata, including the default command and the best-effort
 * interactive login invocation used by the in-app "Sign in" flow.
 */
const PROVIDERS = {
  claude: {
    id: 'claude', label: 'Claude Code', command: 'claude', models: CLAUDE_MODELS,
    install: 'npm i -g @anthropic-ai/claude-code',
    npmPackage: '@anthropic-ai/claude-code',
    docsUrl: 'https://code.claude.com/docs/en/overview',
    login: {
      args: ['/login'],
      hint: 'A Terminal window opens running “claude /login”. Follow the prompts (a browser may open) to authorize your Claude Pro/Max subscription, then come back and click “I’ve finished”.',
    },
  },
  codex: {
    id: 'codex', label: 'Codex', command: 'codex', models: CODEX_MODELS,
    install: 'npm i -g @openai/codex',
    npmPackage: '@openai/codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    login: {
      args: ['login'],
      hint: 'A Terminal window opens running “codex login”. A browser opens to sign in with your ChatGPT account, then come back and click “I’ve finished”.',
    },
  },
  gemini: {
    id: 'gemini', label: 'Gemini API', command: '', models: GEMINI_MODELS,
    install: '',
    npmPackage: null,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    login: {
      args: [],
      hint: 'Add your Gemini API key in Settings. This app uses the Gemini API with separate usage billing; it does not use Gemini CLI login.',
    },
  },
  grok: {
    id: 'grok', label: 'Grok', command: 'grok', models: GROK_MODELS,
    install: 'npm i -g @xai-official/grok',
    npmPackage: '@xai-official/grok',
    docsUrl: 'https://docs.x.ai/build/overview',
    login: {
      args: ['login'],
      hint: 'A Terminal window opens running “grok login”. It opens your browser ONCE to sign in with your xAI account (SuperGrok or X Premium Plus) — no API key needed. Finish in the browser, then come back; ChapterOne detects it automatically.',
    },
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function modelsFor(provider) {
  return (PROVIDERS[provider] || PROVIDERS.claude).models;
}
function providerList() {
  return PROVIDER_IDS.map((id) => {
    const p = PROVIDERS[id];
    return { id, label: p.label, command: p.command, npmPackage: p.npmPackage || null, docsUrl: p.docsUrl || null };
  });
}
function loginFor(provider) {
  return (PROVIDERS[provider] || {}).login || { args: [], hint: '' };
}

module.exports = {
  CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS, GROK_MODELS,
  SUBSCRIPTION_SCRUB, PROVIDERS, PROVIDER_IDS, MODEL_PRESETS, MODEL_NOTICES, CATALOG_REVIEWED_AT,
  modelsFor, providerList, loginFor, presetModel,
};
