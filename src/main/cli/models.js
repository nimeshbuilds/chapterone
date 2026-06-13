'use strict';

/**
 * Provider catalog. We drive each vendor's own CLI on the user's subscription
 * (no API keys). Model lists use stable CLI aliases/ids that resolve to whatever
 * the subscription entitles the user to.
 */

// Model ids are stable CLI aliases/slugs. We always offer "Default" first,
// which lets each CLI pick the best model the user's subscription entitles —
// so it auto-tracks the latest "best Pro" without us hardcoding a preview id
// that might not be enabled on a given account. The named entries below let a
// user pin a specific model, newest/highest-quality listed first.
const CLAUDE_MODELS = [
  { id: '', label: 'Default — best on your plan (recommended)' },
  { id: 'opus', label: 'Claude Opus — highest quality' },
  { id: 'sonnet', label: 'Claude Sonnet — balanced quality & speed' },
  { id: 'haiku', label: 'Claude Haiku — fastest / lightest' },
];

const CODEX_MODELS = [
  { id: '', label: 'Default — best on your plan (recommended)' },
  { id: 'gpt-5.5', label: 'GPT-5.5 — highest quality' },
  { id: 'gpt-5.4', label: 'GPT-5.4 — balanced' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — fastest' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex — code-tuned' },
];

const GEMINI_MODELS = [
  { id: '', label: 'Default — best on your plan (recommended)' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro — highest quality' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — newest (preview)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash — fast' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — stable' },
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
    npmPackage: '@anthropic-ai/claude-code',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
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
    id: 'gemini', label: 'Gemini', command: 'gemini', models: GEMINI_MODELS,
    install: 'npm i -g @google/gemini-cli',
    npmPackage: '@google/gemini-cli',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    login: {
      args: [],
      hint: 'A Terminal window opens running “gemini”. When it starts, choose “Login with Google” (or type /auth) and sign in with the Google account on your Gemini AI Pro/Ultra plan — no API key needed. Then come back and click “I’ve finished”.',
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
  CLAUDE_MODELS, CODEX_MODELS, GEMINI_MODELS,
  SUBSCRIPTION_SCRUB, PROVIDERS, PROVIDER_IDS,
  modelsFor, providerList, loginFor,
};
