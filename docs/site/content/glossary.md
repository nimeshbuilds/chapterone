## The terms in the app

| Term | Meaning |
| --- | --- |
| Brief | Your instructions for the book: reader, purpose, style, scope, and constraints |
| Outline / chapter map | The planned chapter titles and summaries, created before full drafting |
| Outline review gate | A pause that lets you edit and approve the plan before chapter writing |
| Story bible | Saved planning context such as premise, style guide, cast, and chapter map |
| Provider / engine | The company/service and adapter used to generate text |
| Model | The particular AI model or provider alias selected for an engine |
| CLI | A provider's command-line app installed on your computer |
| API key | A credential that permits calls to a provider's API, with that account's access and billing |
| Fallback chain | The ordered list of providers that can be tried when an eligible request fails |
| Checkpoint | Work saved to disk, such as a completed chapter; a live streamed response is not yet a completed checkpoint |
| Editor pass | An optional additional AI revision of a newly generated chapter |
| Rewrite | A provider request that replaces one chapter's prose using your directions |
| Revision history | Up to 20 previous prose versions of a chapter, saved before eligible replacements |
| Manuscript check | Local deterministic checks for practical manuscript issues; not a quality or factual certification |
| Cache | Saved output reused when its inputs still match, such as narration for the same text, voice, and model |
| EPUB | A reflowable e-book file suited to reader-controlled type sizes |
| 6×9 PDF | A fixed-layout PDF with six-by-nine-inch pages; not an automatic print-publishing approval |
| Notarization | Apple's automated review/ticket process for submitted Mac software, separate from editorial review of your book |

## Do I need every provider account?

No. Connect one writing provider. Gemini images and ElevenLabs narration are optional. Add fallback providers only when you want them and understand their data and billing implications.

## Does the app work offline?

You can read saved books, manually edit chapters, compare or restore revisions, run Manuscript check, and export saved content without asking an AI provider. New AI text, research, images, narration, and email delivery require their respective network services. A cached recording can be replayed locally.

## Does a subscription make everything free?

No. Provider subscriptions have limits, CLI configuration can affect billing, and Gemini API/image requests and ElevenLabs actions have their own billing. The subscription preference is not a universal billing guarantee. Read [privacy and costs](privacy-costs.md).

## Can I import an EPUB or a Word document?

The reader currently opens ChapterOne's own library. Arbitrary EPUB import and DOCX round-trip import are not implemented. You can edit chapter Markdown or continue working in the exported file using another application.

## Are books synced between computers?

No automatic cloud sync is provided. Use portable exports and independent backups. Copying app data across machines requires care with encrypted credentials and media paths; see [backups](backups.md).

## Is a generated book ready to publish?

It is a draft that needs your review. Check the facts, structure, voice, suitability, rights, illustrations, and final exported layout. Neither a completed generation nor a clean Manuscript check certifies those things.

## Why does the handbook show a feature I cannot find?

The handbook follows the current documented app code. Your installed release may be older. Check the app version and the published [release notes](https://github.com/nimeshbuilds/chapterone/releases), then update if the feature is included in a newer available installer.

## Where should feature requests go?

Open a [feature request](https://github.com/nimeshbuilds/chapterone/issues/new/choose) describing the actual writing problem, who encounters it, and how you handle it today. A concrete example is more useful than a long list of controls.
