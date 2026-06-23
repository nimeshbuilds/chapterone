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

// Codex on a ChatGPT subscription (gpt-5.5 default, 5.4 fallback, 5.4-mini light).
const CODEX_MODELS = [
  { id: '', label: 'Default — best on your plan (recommended)' },
  { id: 'gpt-5.5', label: 'GPT-5.5 — highest quality' },
  { id: 'gpt-5.4', label: 'GPT-5.4 — balanced' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — fastest' },
];

// Gemini runs via the Gemini REST API with an API key (per-token billing). The
// "-latest" aliases always resolve to the newest model the key is entitled to,
// so they keep working as Google ships new versions without us hardcoding IDs
// the key may not have access to. Flash is the cheap default.
const GEMINI_MODELS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash (latest — currently 3.5 Flash) — recommended' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — newest, best value' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — cheapest' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro — highest quality (pricier)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — pinned stable' },
];

// Grok Build CLI on a SuperGrok / X Premium Plus subscription. Drives `grok -p`
// headless. Models come from `grok models`; grok-build is xAI's latest (512K
// context) and the best default. Composer 2.5 is Cursor's coding model.
const GROK_MODELS = [
  { id: 'grok-composer-2.5-fast', label: 'Composer 2.5 Fast — fastest, great prose (recommended)' },
  { id: 'grok-build', label: 'Grok Build — xAI’s latest, agentic (slower)' },
  { id: '', label: 'CLI default' },
];

// One-click model presets per provider. "Fast" = the quickest/cheapest model,
// "Pro" = the largest/highest-quality, "default" = best on the plan / recommended.
// Used by the Fast/Pro/Default quick-select buttons in the engine bar.
const MODEL_PRESETS = {
  claude: { fast: 'haiku', pro: 'opus', default: '' },
  codex: { fast: 'gpt-5.4-mini', pro: 'gpt-5.5', default: '' },
  gemini: { fast: 'gemini-3.1-flash-lite', pro: 'gemini-3.1-pro-preview', default: 'gemini-flash-latest' },
  grok: { fast: 'grok-composer-2.5-fast', pro: 'grok-build', default: 'grok-composer-2.5-fast' },
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
  grok: {
    id: 'grok', label: 'Grok', command: 'grok', models: GROK_MODELS,
    install: 'npm i -g @xai-official/grok',
    npmPackage: '@xai-official/grok',
    docsUrl: 'https://docs.x.ai/build/cli',
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
  SUBSCRIPTION_SCRUB, PROVIDERS, PROVIDER_IDS, MODEL_PRESETS,
  modelsFor, providerList, loginFor, presetModel,
};
