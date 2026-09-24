## Start with the smallest useful check

Read the exact error, note the app version and OS, and identify the failing step: connecting, drafting, images, audio, exporting, or delivery. Keep your current library intact. Avoid clearing data or repeatedly rerunning paid requests as a first fix.

## The installer will not open

Confirm that the download matches your OS and processor in the [installation table](install.md#choose-your-download). Download only attached assets from a published release and compare the SHA-256 against that release's checksum file.

On macOS, supported releases require Developer ID signing and notarization. If the expected signed file is blocked or reported as damaged, preserve the error and report it; do not disable Gatekeeper system-wide. On Windows, check the release notes for the exact signing status. Version 0.2.1's Windows installers are unsigned, so a publisher warning is expected for those files.

## My provider is installed but not connected

1. In Settings, check both command detection and sign-in status.
2. Open the provider's own terminal app and verify that it starts normally.
3. Complete its sign-in flow, then return to ChapterOne.
4. Choose **Re-check CLIs** and **Check sign-in**.
5. If needed, save the full executable path in the provider's command field and restart ChapterOne.

The in-app **Install** control requires Node.js with npm on PATH. Finder-launched Mac apps and Windows apps can see a different PATH from an already-open terminal. Command fields accept executable paths, not shell scripts or multiple commands.

For Gemini, use the API-key settings. Signing into a separate Gemini CLI does not configure this app's REST connection.

## A model is missing or rejected

Check the [model reference](model-reference.md) and the provider's current account access. Update the provider CLI if the model requires a newer version. A model offered by a provider API is not necessarily accepted by its CLI.

For an unlisted model, use **Custom model…** with the exact supported ID. A Claude Code or Codex **Check model** sends a short prompt and can consume usage. If a saved model has retired, explicitly select a supported replacement; the app preserves saved pins rather than silently changing them.

If you cannot tell whether the model or sign-in is the problem, test the provider's Default choice and inspect the error. Default is a troubleshooting choice, not a promise of newest-model access.

## Writing stopped or all providers failed

Read the progress log for authentication, quota, model access, rate limit, network, or timeout errors. Resolve that cause with the provider before choosing **Continue** on the paused book.

Completed chapter text is saved. The unfinished response may need to run again and use more quota. If you enable fallback, connect and test each intended provider first; every fallback must be acceptable for the manuscript's data and billing.

If you stopped during planning before a book was saved, you may need to start again from the brief. If a saved outline or chapters exist, inspect them in the library before making a duplicate book.

## The app says another operation is running

Generation, resume, and AI rewrite share a writing slot. Destructive changes and some edits are blocked while writing, narration, export, or delivery is active. Finish or stop writing, wait for the other operation, then retry once.

Pausing audio playback does not cancel an in-flight narration request. If an operation appears stuck, record its last visible status before quitting. Do not manually delete app-data files while the app is using them.

## A picture is missing

Check the chosen image mode and the progress log. For Nano Banana, confirm the saved Gemini key, model availability, account limits, and provider response. A successful key check reads metadata; it does not guarantee a later image generation will succeed.

The prose is saved before optional illustration work, so a text-only result can be valid even when art failed. Resume does not automatically refill every missing picture. Word exports omit illustrations by design; inspect EPUB, HTML, or PDF when you need included art.

## Narration fails or plays the wrong text

Verify the ElevenLabs key, chosen voice, voice-model compatibility, and account usage. Check your selected audio output and system volume if playback is silent.

The cache distinguishes chapter text, voice, and model. After editing a chapter, generating matching new narration can cost additional usage. An MP3 exported before the edit remains an old independent file; export again after narrating the new text.

For a partly generated audiobook, retry the full-book generation workflow to reuse matching completed chapters and attempt the missing ones. An in-flight request is not cancelled just because playback or a dialog is closed.

## An export looks wrong

Make sure edits were saved, then create a fresh export. Open it in an independent application. Use Word for text editing, EPUB for reflowable reading, or PDF for a fixed page layout; they do not have identical layout behavior.

DOCX does not embed illustrations. The 6×9 PDF option sets trim dimensions but does not guarantee publishing-platform acceptance. If an export fails, verify the destination folder is writable and that a conflicting copy is not locked by another application.

## Kindle or email delivery did not arrive

Distinguish a mail-app hand-off from SMTP sending. On macOS, a Mail draft still needs to be sent. On Windows, the revealed attachment still needs to be uploaded or attached manually.

For SMTP, check host, port, credentials, sender address, and the provider's app-password requirements. A successful **Verify SMTP** result is not proof that Amazon accepted the book. Check Amazon's approved-sender settings and any rejection message in your mailbox.

## Saved keys cannot be read

Unlock your macOS Keychain or sign in to the correct Windows account. Credentials encrypted for another account may not decrypt after a manual move. The app preserves unreadable settings instead of silently resetting them.

Keep a backup of the files before attempting recovery. Re-enter or rotate keys through the proper provider account if needed; never paste them into an issue, screenshot, or shared log.

## A book seems missing after an update

Confirm the OS account and app-data location. Earlier app names or different packaging may use another folder under Application Support or AppData. Do not create a replacement library over the only copy of your files.

See [backups and folder locations](backups.md#make-a-library-backup). Preserve all candidate folders and independent exports before asking for help.

## Report a reproducible problem

Use the [issue templates](https://github.com/nimeshbuilds/chapterone/issues/new/choose). Include:

- App version, OS version, and processor architecture.
- The exact steps and what you expected to happen.
- The error text and the failing phase.
- Provider/CLI version and model choice if relevant, without credentials.
- Whether the problem occurs with a small non-private example.

Remove manuscript text, account details, and secrets from logs and screenshots. Use [private security reporting](privacy-costs.md#report-a-security-problem-privately) for vulnerabilities.
