## Connect ElevenLabs

1. Open **Settings → Audiobook · ElevenLabs**.
2. Enter your ElevenLabs API key and choose a voice model.
3. Choose **Save**, then **Load voices**.
4. Select a default narrator, and optionally a different narrator for children's books.
5. Use **Test key** to check access.

Audio is separate from your writing provider and Gemini image key. Narration sends manuscript text to ElevenLabs and uses its quota or billing. Model availability and supported voices depend on your account. See the [model reference](model-reference.md) for the reviewed choices.

## Listen to one chapter

Open a chapter in the reader and choose **Listen**. The app generates missing audio, saves it locally, and then plays it. A long chapter may be divided into multiple narration requests.

When you change chapters, the reader stops the previous chapter's playback and prompts you to listen to the new one. Selecting a chapter is not itself permission to generate every chapter's audio.

## Listen through the whole book

Use the whole-book playback control to advance through chapters. Already cached audio is reused; any chapter that is not cached can be narrated on demand. Playback position is remembered locally so you can continue later.

The full-audiobook generation control prepares the book's chapters ahead of time. Review its confirmation: it shows how many chapters still need narration and an approximate usage estimate. If some chapters fail, running it again reuses matching successful chapters and retries what is missing.

## Understand the audio cache

Saved narration is matched to the **chapter's spoken text, voice, and model**. Replaying a matching cached recording makes no new narration request. Editing the chapter or switching the voice/model may require new audio and additional usage.

Exported MP3s are independent files; editing a book does not update them. If you restore an earlier chapter version and matching cached audio still exists, that matching recording can be reused.

## Stop playback versus stop generation

Pausing the player stops what you hear. It does not guarantee cancellation of an in-flight paid narration request. The app does not currently offer a complete narration-cancel control. Wait for active narration to finish before trying to delete a book or clear its data.

Completed cached chapters survive interruptions. An unfinished request may need to run again. Closing a dialog or switching app views should not be treated as a billing stop button.

## Clone a voice with permission

Settings includes a voice-cloning flow with consent and microphone or sample-upload controls. Use your own voice or a voice you have permission to clone. Samples are sent to ElevenLabs, and the cloned voice exists in that provider account.

If recording is unavailable, check OS microphone permissions and your selected input device. Deleting ChapterOne's local data does not delete voices or samples held by the provider. Manage those through your ElevenLabs account.

## Export audio

Use the chapter MP3 export control when that chapter's audio is ready. Save the result outside the app data folder, then play the exported file to confirm its content. The current reader exposes chapter MP3 export; whole-book controls prepare and play cached chapters in sequence, rather than offering a combined audiobook file download.

**Exporting a chapter MP3 can generate narration if no matching recording is cached.** The app asks **Narrate this chapter before exporting?** before proceeding when the matching recording is missing. Choose **Narrate & export** only when you want that paid request. The app then prepares the audio before showing the save dialog. Cancelling that later file-save dialog does not undo provider usage already incurred. Choose the intended text, voice, and model before exporting.

If you get no sound, check the selected output device, system volume, and player state before generating again. See [audio troubleshooting](troubleshooting.md#narration-fails-or-plays-the-wrong-text).
