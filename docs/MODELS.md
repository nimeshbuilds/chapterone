# Model catalog

Reviewed **September 23, 2026** against the provider documentation below. These are supported selections for ChapterOne's existing text, illustration, and narration integrations. Availability still depends on the account, region, rollout, and installed CLI. The catalog is a dated snapshot, not an account entitlement check.

## Choose a model without guessing

1. Connect a writing provider in **Settings**. Pick **Default** to use your CLI configuration (or Google's latest Flash alias for Gemini).
2. Choose **Fast** for a short first draft or **Pro** for a more demanding writing task. Those presets select different models where the provider exposes suitable choices; they are not quality guarantees.
3. Choose a named, pinned version when you want repeatable model selection. Choose an alias when you want the provider to update the underlying model over time.
4. Keep a working model selected if a new one is not available to your account. Updating ChapterOne does not grant provider access.

**What changed in this review:** added Claude Opus 5.5, GPT-6 Sol and Luna; refreshed Codex Fast/Pro presets; added older Gemini 3.7/3.6 pins; documented Grok 4.7 behind the current Build integration; and made ElevenLabs' Turbo deprecation visible. Image and current ElevenLabs narration choices were rechecked and remain appropriate.

## Writing

| Integration | Current selections | Presets and compatibility |
| --- | --- | --- |
| Claude Code | Fable, Opus, Sonnet, Haiku aliases; pinned Fable 5.1, **Opus 5.5**, Opus 5, Sonnet 5 | Fast = Haiku, Pro = Opus. Aliases follow provider configuration. Opus 5.5 needs CLI **2.1.280+**; Fable 5.1 needs 2.1.257+, Opus 5 needs 2.1.219+, Sonnet 5 needs 2.1.197+. Fable can bill usage credits without a headless confirmation, depending on the plan. |
| Codex | GPT-6 Astra, **GPT-6 Sol**, **GPT-6 Luna**; previous GPT-5.6 Sol, Terra, Luna; legacy GPT-5.5 | Fast = GPT-6 Luna, Pro = GPT-6 Sol. Astra remains an explicit choice because access and quota use differ. Default omits the model flag. Existing saved pins stay unchanged. |
| Gemini REST API | Flash latest alias, stable 3.8 Flash, 3.5 Flash-Lite, 3.1 Pro preview; older pinned 3.7/3.6/3.5 Flash and 3.1 Flash-Lite | Fast = 3.5 Flash-Lite, Pro = 3.1 Pro preview. The latest alias can target stable, preview, or experimental models. API billing is separate from subscriptions. |
| Grok Build CLI | CLI default and `grok-build`; xAI now identifies **Grok 4.7** as Build's default | Pro = Grok Build; Fast and Default use CLI configuration. No new Fast ID is assumed. Check account-specific custom choices with `grok models`. |

Sources: [Claude Code model configuration](https://code.claude.com/docs/en/model-config), [Codex models](https://learn.chatgpt.com/docs/models), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Grok settings](https://docs.x.ai/build/settings), [Grok 4.7](https://docs.x.ai/developers/grok-4-7), [Grok CLI reference](https://docs.x.ai/build/cli/reference).

Opus 5.5's exact pin is `claude-opus-5-5`. Its thinking cannot be disabled. ChapterOne delegates request compatibility to Claude Code rather than sending Anthropic API parameters itself. Update the CLI using `claude update` if the selection is rejected. See [Opus 5.5 migration](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

The Codex adapter keeps its existing medium reasoning setting and respects advanced overrides. It does not change endpoints, add API keys, or force a more expensive tier when you choose a new model. See [OpenAI model migration guidance](https://developers.openai.com/api/docs/guides/latest-model).

Grok 4.7 Fast is documented as a premium Build/Cursor option, but the cited docs do not establish a portable subscription CLI ID for it. ChapterOne therefore keeps the verified Build alias. The standalone `grok-4.7` API example requires API configuration and is not advertised as a guaranteed subscription choice. See [Grok 4.7 availability](https://docs.x.ai/developers/grok-4-7).

## Existing selections and retirement

Saved model IDs are preserved, including custom and older IDs. An application update does not silently replace a user's pin or change a configured provider endpoint. Custom text-model IDs can be entered without waiting for another ChapterOne release.

- GPT-5.4 and GPT-5.4 mini retired from Codex with ChatGPT sign-in on August 31, 2026. The UI retains the announced GPT-5.6 Terra/Luna migration guidance. GPT-5.5 is scheduled to retire on October 14; GPT-5.6 Sol remains the announced replacement, with newer selections available where enabled. GPT-5.3-Codex-Spark retired from the CLI on September 14. API-key access is separate. See the [Codex changelog](https://learn.chatgpt.com/docs/changelog).
- The old Grok Composer preset is no longer advertised. A saved selection is retained with a notice to check the current CLI model list or choose its default.
- Custom-model checks run only when **Check model** is pressed. Claude and Codex send a short test prompt, using quota or API billing; the UI says so. Gemini and Grok read model metadata without generating content. Merely opening the app, typing, changing presets, or navigating does not trigger those checks.

Background status and **Check sign-in** do not generate model text. Claude Code uses `claude auth status`; Codex uses `codex login status`; Gemini reads API model metadata; Grok checks its local sign-in cache. Unsupported status commands and unreadable results remain unknown instead of falling back to a paid request. A stored sign-in does not establish current quota, model access, subscription billing, or compatibility with advanced generation overrides. Sources: [Claude CLI reference](https://code.claude.com/docs/en/cli-reference), [Codex CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

## Illustrations and narration

New installations use **Nano Banana 2**, which supports multiple reference images. Nano Banana 2 Lite is offered for simpler, lower-cost images, and Pro for complex artwork. The original Nano Banana remains selectable for existing pins with an October 2, 2026 shutdown notice. Existing image settings are preserved.

Image estimates use standard 1K output pricing: Nano Banana 2 $0.067, 2 Lite $0.0336, Pro $0.134. Input and thinking tokens cost extra; these are estimates, not spending limits. Requests continue to use Google's documented `generateContent` interface, and the parser excludes interim thinking images. Sources: [image models](https://ai.google.dev/gemini-api/docs/image-generation), [generateContent image API](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [pricing and retirement notice](https://ai.google.dev/gemini-api/docs/pricing).

ElevenLabs offers **Multilingual v2**, **Eleven v3**, **Flash v2.5**, and the deprecated Turbo v2.5 for existing selections. Prefer Flash over Turbo. Multilingual v2 remains the audiobook default. V3 requests use its supported stability setting without similarity or speaker boost; requests stay below its 5,000-character limit. Conversational/WebSocket, transcription, voice-design, and music models use different workflows and are not added to the audiobook dropdown. Sources: [ElevenLabs models](https://elevenlabs.io/docs/overview/models), [voice controls](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech).

Google also released Gemini 3.8 Flash TTS and Flash-Lite TTS on September 22. Those require a separate narration integration; they cannot be used in the writing dropdown or the ElevenLabs endpoint. ChapterOne currently narrates through ElevenLabs. See [Google's release notes](https://ai.google.dev/gemini-api/docs/changelog).

## Validation and maintenance

Offline tests cover catalog/preset consistency, CLI model arguments, default and saved-pin behavior, reasoning overrides, image request bodies and final-image selection, narration request settings and chunking, and actual Electron model controls. Grok parsing tests also protect manuscript dates, scene breaks, and metadata-like prose from being mistaken for CLI output. Native CI runs these checks against source and packaged code on both Mac and Windows architectures. This does not establish live account access or writing quality for every listed model; those need the manual release checks with authorized accounts.

Before each release:

1. Revisit the primary sources above, including retirement dates. Check the integration actually used by this app; an API model is not necessarily a CLI subscription model.
2. Update `src/main/cli/models.js`, image/audio catalogs, notes, and `CATALOG_REVIEWED_AT`. Keep fast and quality presets distinct where verified choices exist. Preserve saved settings.
3. Verify endpoint parameters, media parsing, and character limits when adding a model family. Update request fixtures, then run `npm run verify` and `npm run test:smoke`.
4. Complete native CI and the live-provider acceptance checklist before publishing installers. Never use billed requests as automatic test fixtures.
