# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report it privately via GitHub's
[private vulnerability reporting](https://github.com/npandeya/bookwriter/security/advisories/new)
(Security → Report a vulnerability), or email the maintainer.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- the app version and your OS.

We'll acknowledge your report as quickly as we can and keep you updated on a fix.

## Security model

ChapterOne is a **local-first** desktop app. It is designed so that:

- **Your subscription, not API keys.** The app strips `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, and `GEMINI_API_KEY` from the CLI's child-process
  environment so text generation always uses your interactive subscription
  login.
- **No backend.** There is no ChapterOne server. Your books, settings, and keys
  live only on your machine (under the app's user-data directory).
- **Least privilege to the model.** When research is enabled, only the CLI's
  read-only web tools are allowed — never file-editing or shell access.
- **SVG is sanitized.** Any model-produced SVG is stripped of scripts, event
  handlers, `foreignObject`, and external references before it is embedded or
  rasterized.
- **Explicit outbound network only.** Network calls happen for research web
  search (via the CLI), opt-in image generation/lookups, opt-in audiobook
  narration, and the Send-to-Kindle email you trigger.

## Handling of secrets

Optional API keys (Gemini image key, ElevenLabs key) and SMTP credentials are
stored locally in the app's settings file and are sent only to their respective
services when you use the corresponding feature. They are never transmitted to
any ChapterOne-operated endpoint (there isn't one). Use **Settings → Clear all
my data** to erase them along with everything else.
