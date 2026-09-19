# Model catalog

Reviewed **September 19, 2026** against the provider documentation below. These are supported selections for ChapterOne's existing text, illustration, and narration integrations. Availability still depends on the account, region, rollout, and installed CLI. The catalog is a dated snapshot, not an account entitlement check.

## Writing

| Integration | Current selections | Presets and compatibility |
| --- | --- | --- |
| Claude Code | Fable, Opus, Sonnet, Haiku aliases; pinned Fable 5.1, Opus 5, Sonnet 5 | Fast = Haiku, Pro = Opus. Aliases follow provider configuration. Pinned Fable 5.1 needs CLI 2.1.257+, Opus 5 needs 2.1.219+, Sonnet 5 needs 2.1.197+. Fable may need usage credits and billing consent in Claude Code before headless generation. |
| Codex | GPT-6 Astra; GPT-5.6 Sol, Terra, Luna; legacy GPT-5.5 | Fast = Luna, Pro = Sol. Astra is an explicit choice because plan access and quota use differ. Default omits the model flag. |
| Gemini REST API | Flash latest alias, stable 3.8 Flash, 3.5 Flash-Lite, 3.1 Pro preview; older pinned 3.5 Flash and 3.1 Flash-Lite | Fast = 3.5 Flash-Lite, Pro = 3.1 Pro preview. The Flash latest alias follows Google and may target stable, preview, or experimental models. API billing is separate from subscriptions. |
| Grok Build CLI | CLI default and `grok-build` | Pro = Grok Build; Fast and Default use the CLI configuration. There is no separately verified fast subscription alias. API model names such as Grok 4.6 are not assumed to work with subscription login; check custom IDs with `grok models`. |

Sources: [Claude Code model configuration](https://code.claude.com/docs/en/model-config), [Codex models](https://learn.chatgpt.com/docs/models), [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Grok settings](https://docs.x.ai/build/settings), [Grok CLI reference](https://docs.x.ai/build/cli/reference).

## Existing selections and retirement

Saved model IDs are preserved, including custom and older IDs. An application update does not silently replace a user's pin or change a configured provider endpoint. Custom text-model IDs can be entered without waiting for another ChapterOne release.

- GPT-5.4 and GPT-5.4 mini retired from Codex with ChatGPT sign-in on August 31, 2026. The UI suggests Terra and Luna respectively. GPT-5.5 is scheduled to retire from that integration on October 14, 2026; Sol is the suggested replacement. API-key access is separate. See [Codex retirement guidance](https://learn.chatgpt.com/docs/models).
- The old Grok Composer preset is no longer advertised. A saved selection is retained with a notice to check the current CLI model list or choose its default.
- Custom-model checks run only when **Check model** is pressed. Claude and Codex send a short test prompt, using quota or API billing; the UI says so. Gemini and Grok read model metadata without generating content. Merely opening the app, typing, changing presets, or navigating does not trigger those checks.

## Illustrations and narration

New installations use **Nano Banana 2**, which supports multiple reference images. Nano Banana 2 Lite is offered for simpler, lower-cost images, and Pro for complex artwork. The original Nano Banana remains selectable for existing pins with an October 2, 2026 shutdown notice. Existing image settings are preserved.

Image estimates use standard 1K output pricing: Nano Banana 2 $0.067, 2 Lite $0.0336, Pro $0.134. Input and thinking tokens cost extra; these are estimates, not spending limits. Requests continue to use Google's documented `generateContent` interface, and the parser excludes interim thinking images. Sources: [image models](https://ai.google.dev/gemini-api/docs/image-generation), [generateContent image API](https://ai.google.dev/gemini-api/docs/generate-content/image-generation), [pricing and retirement notice](https://ai.google.dev/gemini-api/docs/pricing).

ElevenLabs offers **Multilingual v2**, **Eleven v3**, **Flash v2.5**, and the previous Turbo v2.5. Multilingual v2 remains the audiobook default. V3 requests use its supported stability setting without similarity or speaker boost; requests stay below its 5,000-character limit. Conversational/WebSocket models are not added to the audiobook dropdown. Sources: [ElevenLabs models](https://elevenlabs.io/docs/overview/models), [voice controls](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech).

## Validation and maintenance

Offline tests cover catalog/preset consistency, CLI model arguments, default and saved-pin behavior, image request bodies and final-image selection, narration request settings and chunking, and actual Electron model controls. Native CI repeats these checks against source and packaged code on both Mac and Windows architectures. This does not establish live account access or writing quality for every listed model; those need the manual release checks with authorized accounts.

Before each release:

1. Revisit the primary sources above, including retirement dates. Check the integration actually used by this app; an API model is not necessarily a CLI subscription model.
2. Update `src/main/cli/models.js`, image/audio catalogs, notes, and `CATALOG_REVIEWED_AT`. Keep fast and quality presets distinct where verified choices exist. Preserve saved settings.
3. Verify endpoint parameters, media parsing, and character limits when adding a model family. Update request fixtures, then run `npm run verify` and `npm run test:smoke`.
4. Complete native CI and the live-provider acceptance checklist before publishing installers. Never use billed requests as automatic test fixtures.
