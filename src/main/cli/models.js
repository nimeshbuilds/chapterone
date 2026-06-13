'use strict';

/**
 * Provider catalog. We drive each vendor's own CLI on the user's subscription
 * (no API keys). Model lists use stable CLI aliases/ids that resolve to whatever
 * the subscription entitles the user to.
 */

const CLAUDE_MODELS = [
  { id: '', label: 'Default (recommended)' },
  { id: 'sonnet', label: 'Claude Sonnet — balanced quality & speed' },
  { id: 'opus', label: 'Claude Opus — highest quality' },
  { id: 'haiku', label: 'Claude Haiku — fastest / cheapest' },
];

const CODEX_MODELS = [
  { id: '', label: 'Default (recommended)' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'o4-mini', label: 'o4-mini — fast' },
];

const GEMINI_MODELS = [
  { id: '', label: 'Default (recommended)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — highest quality' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast' },
];

/** Env vars that force API-key billing; stripped so the CLI uses the
 * subscription login instead. */
const SUBSCRIPTION_SCRUB = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'OPENAI_API_BASE'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'],
};

/**
 * Per-provider metadata, including the default command and the best-effort
 * interactive login invocation used by the in-app "Sign in" flow.
 */
const PROVIDERS = {
  claude: {
    id: 'claude', label: 'Claude Code', command: 'claude', models: CLAUDE_MODELS,
    install: 'npm i -g @anthropic-ai/claude-code',
    login: {
      args: ['/login'],
      hint: 'Starts Claude Code sign-in. A browser opens to authorize your Claude (Pro/Max) subscription. If the in-app flow can’t start, run “claude” in a terminal and use /login.',
    },
  },
  codex: {
    id: 'codex', label: 'Codex', command: 'codex', models: CODEX_MODELS,
    install: 'npm i -g @openai/codex',
    login: {
      args: ['login'],
      hint: 'Runs “codex login”. A browser opens to sign in with your ChatGPT account.',
    },
  },
  gemini: {
    id: 'gemini', label: 'Gemini', command: 'gemini', models: GEMINI_MODELS,
    install: 'npm i -g @google/gemini-cli',
    login: {
      args: [],
      hint: 'Launches the Gemini CLI sign-in. A browser opens to authorize your Google account (free Gemini tier or Code Assist).',
    },
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

function modelsFor(provider) {
  return (PROVIDERS[provider] || PROVIDERS.claude).models;
}
function providerList() {
  return PROVIDER_IDS.map((id) => ({ id, label: PROVIDERS[id].label }));
}
function loginFor(provider) {
  return (PROVIDERS[provider] || {}).login || { args: [], hint: '' };
}

module.exports = {
  CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS,
  SUBSCRIPTION_SCRUB, PROVIDERS, PROVIDER_IDS,
  modelsFor, providerList, loginFor,
};
