## Keep two kinds of copy

An **export** is a portable manuscript or audio file that other applications can read. A **library backup** preserves ChapterOne's own book data, outlines, revision history, media, and settings. Keep both when the work matters to you.

There is no built-in library backup/import interface or cloud sync. Revision history helps with prose changes, but it lives with the book and is limited to 20 previous versions per chapter. It does not replace an independent backup.

## Make a library backup

1. Finish or pause writing and wait for narration, export, and delivery operations to finish.
2. Export important manuscripts into formats you can read without ChapterOne.
3. Quit ChapterOne completely.
4. Find the app-data folder for the installed app.
5. Copy the entire folder to a dated location on another drive or your chosen backup service.

Typical locations are:

| System | App-data location |
| --- | --- |
| macOS | `~/Library/Application Support/chapterone` |
| Windows | `%APPDATA%\chapterone` |

Packaged app names and earlier versions may use **ChapterOne** or a previous product name in the same OS app-data parent directory. On a Mac, use Finder's **Go → Go to Folder** to open `~/Library/Application Support/`. On Windows, enter `%APPDATA%` in File Explorer. Identify the folder containing `books`, `images`, `audio`, and `settings.json`; do not assume a similarly named app-install folder is the library.

Copy rather than move the live folder. Back up while the app is closed so book records and their media are from a consistent point in time.

## What the folder contains

- `books/`: each book's JSON data, including prose, outline, metadata, reference photos, and retained chapter revisions.
- `images/`: generated/downloaded art and rendered images.
- `audio/`: cached chapter narration.
- `exports/`: app-managed default or temporary export files.
- `settings.json` and `settings.json.bak`: preferences and encrypted credential values.
- Chromium storage files: local reader preferences and playback position.

The JSON files also reference media paths. Editing those files or rearranging folders by hand can break those links. Keep an untouched backup before any recovery attempt.

## Recover interrupted writing

After a crash or restart, completed saved chapters remain available. An interrupted book with saved progress should appear as paused. Open it to inspect the saved chapters, then choose **Continue** to resume from the next checkpoint.

An unfinished model response may have to be repeated. An outline-only book may have no chapter text yet. Resume does not automatically regenerate every missing illustration. See [writing recovery details](writing.md#pause-and-continue).

If settings cannot be read or decrypted, the app preserves the existing files instead of silently replacing them. Unlock the OS credential store or restore a known-good backup only after copying the current files somewhere safe. Do not use **Clear all my data** as a troubleshooting step for a valuable library.

## Move to another computer

Portable exports are the simplest way to carry a manuscript into another editor. Moving the complete ChapterOne library currently requires manual care:

1. Preserve an untouched backup on the original computer.
2. Install ChapterOne on the destination and quit it before replacing data.
3. Copy library data carefully, keeping the folder structure intact.
4. Expect to reconnect providers and re-enter API keys on the destination OS account.
5. Inspect books, media, and exports before removing anything from the original device.

Encrypted credentials are tied to OS account protection and may fail to decrypt elsewhere. Absolute media paths can also differ between computers. Cross-machine restoration is not an automated or guaranteed migration feature. Keep independent exports usable even if the app-data restore needs technical help.

## Delete with care

**Delete book** removes that book and its app-managed artwork, audio, and revision history. Separately saved exports remain.

**Settings → Clear all my data** requires a typed confirmation and removes the app-managed library, media, exports, settings, credential backups, and reader preferences. There is no app-level undo. It does not revoke CLI logins, remove remote provider data or cloned voices, delete OS backups, or recall files and emails already shared.

If your goal is to disconnect a provider, use that provider's own logout or key-revocation controls as appropriate. Deleting app files alone does not revoke a remote account credential.
