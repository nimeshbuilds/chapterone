## Local library, connected AI work

ChapterOne has no app backend, analytics SDK, or automatic crash-upload service. Books and media are stored on your computer. That does **not** make AI generation offline: providers receive the prompts and context needed for the actions you request.

| Action | Data leaving your computer | Destination |
| --- | --- | --- |
| Planning, drafting, rewriting | Briefs, relevant manuscript text, continuity and planning context | The selected writing provider; enabled fallbacks may receive it too |
| Research grounding | Search queries and relevant context | The writing provider's web tools/services |
| Nano Banana illustration | Image prompts and any selected reference photos | Google |
| Narration | Spoken manuscript text | ElevenLabs |
| Voice cloning | Voice samples and cloning information | ElevenLabs |
| SMTP delivery | Book attachment, addresses, and message | Your mail server and recipient |
| CLI installation | Package-download requests | npm and the provider's distributed software |

Providers have their own retention, training, privacy, regional, and billing policies. Check the policies of the account you actually use. Removing a local book does not remove copies already processed or stored by a service.

## Which actions can cost money

- **Writing, clarification, research, editing passes, and AI rewrites** use provider quota or API billing.
- **Automatic fallback** can move work to a different account with different charges.
- **Claude Code and Codex custom model checks** send a small test prompt.
- **Writing-engine illustrations** consume writing-provider usage.
- **Nano Banana images** use the Gemini image API. Displayed estimates do not cap spending.
- **Narration and voice cloning** follow your ElevenLabs account's terms and usage rules.
- **Chapter MP3 export** can generate and bill missing narration before the file-save dialog opens. Cancelling the save does not reverse that usage.

Reading saved books, manually editing chapters, comparing/restoring saved revisions, running the deterministic Manuscript check, and exporting saved manuscript content do not request new AI text. An audio action may generate missing narration; inspect that workflow before assuming everything is cached.

## Keep your first experiment small

Start with one connected provider, a small book, no illustrations, and no audio. Enable outline review so you can check direction before full drafting. Use the provider's own usage dashboard and budget controls; ChapterOne is not a unified spend meter or a hard limit for all services.

The **Use subscription** setting strips known API-key environment variables from CLI launches. It cannot guarantee subscription billing when the provider's CLI has its own account or configuration choices. Confirm billing with the provider.

## How credentials are stored

Saved Gemini keys, ElevenLabs keys, and SMTP passwords use Electron's OS-backed credential encryption: macOS Keychain or Windows DPAPI. They are decrypted in the running app and Settings UI when needed.

Books, character photos, audio, revisions, and exports are ordinary **unencrypted local files**. Protect your OS account and use device encryption if your manuscript needs that protection. Copying encrypted settings to another account is not a way to transfer usable credentials.

Revision history deliberately retains previous prose after an edit or rewrite. Removing sensitive text from the current chapter does not immediately remove retained versions from the book JSON or existing backups. Up to 20 previous versions remain per chapter; manuscript exports omit that history. See [revision retention](revisions.md#restore-an-earlier-version) before relying on an edit as deletion.

## Review before publishing

AI-generated prose and pictures need human review. Research does not certify facts; age-band settings do not certify child suitability; a Manuscript check does not certify quality, originality, or rights. Consider privacy when including real names, personal histories, likenesses, or confidential material in a brief.

The desktop renderer is sandboxed, generated prose is sanitized, and generated artwork is rendered in an isolated offline session. These are technical boundaries, not a promise that content is true or appropriate. External provider CLIs remain separately installed applications with their own configuration.

## Report a security problem privately

Use the repository's [private vulnerability reporting](https://github.com/nimeshbuilds/chapterone/security/advisories/new) when available. Include the version, OS, reproduction steps, and expected impact. Do not put credentials or a private manuscript into a public issue.

See the full [security policy](https://github.com/nimeshbuilds/chapterone/blob/main/SECURITY.md) for implementation details and deletion limits. This handbook uses no analytics or external search service; its host, GitHub Pages, has its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
