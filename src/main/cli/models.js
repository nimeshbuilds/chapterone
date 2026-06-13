'use strict';

/**
 * Curated model choices per provider. We use the CLI's stable model *aliases*
 * where possible (e.g. "sonnet", "opus") because those resolve to whatever the
 * user's subscription entitles them to — no API key, no hard-coded billing.
 * Users can also type any custom model id.
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

/** Environment variables that force API-key billing; we strip them so the CLI
 * falls back to the user's interactive subscription login. */
const SUBSCRIPTION_SCRUB = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'OPENAI_API_BASE'],
};

function modelsFor(provider) {
  return provider === 'codex' ? CODEX_MODELS : CLAUDE_MODELS;
}

module.exports = { CLAUDE_MODELS, CODEX_MODELS, SUBSCRIPTION_SCRUB, modelsFor };
