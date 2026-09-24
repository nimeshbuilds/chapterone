## Choose your download

Open [ChapterOne releases](https://github.com/nimeshbuilds/chapterone/releases) and select the newest **published** release. Download an installer attached to that release, rather than a source-code archive or a development build.

| Your computer | Download | Supported systems |
| --- | --- | --- |
| Mac with Apple Silicon or Intel | `ChapterOne-<version>-mac-universal.dmg` | macOS 13 Ventura or later |
| Windows PC with Intel or AMD processor | `ChapterOne-<version>-win-x64-setup.exe` | 64-bit Windows 10 or 11 |
| Windows PC with an ARM processor | `ChapterOne-<version>-win-arm64-setup.exe` | Windows 11 on ARM |

The Mac ZIP is an alternative to the DMG. The universal Mac app contains both processor architectures. Windows 7/8, 32-bit Windows, and macOS 12 or earlier are unsupported. Linux installers are not included in the release matrix.

On Windows, **Settings → System → About → System type** helps you choose x64 or ARM64. You do not need a separate Node.js installation just to run the packaged app.

## Install on a Mac

1. Download the universal DMG.
2. Open it and drag **ChapterOne** into **Applications**.
3. Eject the disk image.
4. Open ChapterOne from Applications.
5. Continue to [connect a writing provider](providers.md).

Published Mac releases must be signed with a Developer ID and notarized by Apple. If macOS reports that an expected release is damaged or cannot be verified, compare its checksum and consult [installation troubleshooting](troubleshooting.md#the-installer-will-not-open). Do not disable system-wide security to run a download.

## Install on Windows

1. Download the installer that matches your processor.
2. Open the installer and follow its prompts. It installs for your current user.
3. Launch ChapterOne from its shortcut or Start menu.
4. Continue to [connect a writing provider](providers.md).

Check the release's signing notes before installing. **The Windows installers in version 0.2.1 are unsigned** and may show an Unknown publisher or SmartScreen warning. A checksum confirms that a file matches the release; it does not establish the publisher's identity or replace code signing. Later release notes are the authority for that version's signing status.

## Verify a downloaded file

Download `SHA256SUMS.txt` from the **same release** as your installer. Calculate your file's SHA-256 and compare the entire result with the entry for its filename.

On macOS, open Terminal in the download folder:

```sh
shasum -a 256 ChapterOne-<version>-mac-universal.dmg
```

On Windows, open PowerShell in the download folder:

```powershell
Get-FileHash .\ChapterOne-<version>-win-x64-setup.exe -Algorithm SHA256
```

Replace `<version>` and the filename with your actual download. Stop if the hashes differ; delete that download and fetch the release asset again.

## Update without losing your library

1. Finish or pause active writing. Wait for exports and narration to finish.
2. [Back up your library](backups.md#make-a-library-backup) and keep an independent manuscript export.
3. Quit ChapterOne.
4. Download the newer installer and install it using the same procedure.
5. Open the app and check that your books and provider settings are available.

There is no automatic updater. Installing the app and storing its library are separate operations; replacing the app should not be used as a backup strategy. If you are moving between computers or OS accounts, read [moving a library](backups.md#move-to-another-computer).

## Uninstall

On a Mac, quit ChapterOne and remove it from Applications. On Windows, use the installed app's uninstaller through Windows Settings. Removing the application is not the same as deleting its library or revoking provider access. See [deleting local data](backups.md#delete-with-care) if that is your goal.

## If the download page is unavailable

ChapterOne's repository and published releases are public. Check that you are using the official [nimeshbuilds/chapterone releases page](https://github.com/nimeshbuilds/chapterone/releases) and that the version you need has been published rather than left as a draft. If GitHub itself is unavailable, check [GitHub Status](https://www.githubstatus.com/) and retry later.
