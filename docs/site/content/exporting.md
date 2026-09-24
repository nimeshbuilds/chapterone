## Pick a format for the next person

Open the book in the reader and choose **Export**. Saving a new export does not change an older copy already sent to someone else.

| Format | Use it for | Check before sharing |
| --- | --- | --- |
| EPUB | Kindle delivery and reflowable e-readers | Contents navigation, images, and reading order in an independent reader |
| PDF | A fixed-layout review or sharing copy | Page breaks, type size, margins, and image quality |
| 6×9 PDF interior | A starting point for a trade-size print interior | Your printer's trim, margins, bleed, fonts, and image requirements |
| Word (`.docx`) | Human editing and comments | Text formatting; illustrations are not currently embedded |
| Single-file HTML | A self-contained web-page copy | Open it in a browser; this does not publish or host the file |
| Markdown (`.md`) | A portable text manuscript | Formatting and any image references in your next editing tool |
| MP3 | An individual narrated chapter | Narration text, voice, and successful completion |

EPUB, PDF, DOCX, HTML, and Markdown are six manuscript export choices when the two PDF layouts are counted separately. MP3 belongs to the optional audio workflow.

An MP3 export can generate missing narration before the save dialog opens and use your ElevenLabs quota or billing even if you later cancel saving the file. See [audio export](audio.md#export-audio).

## A review before every important export

1. Save your latest edits and finish any active operation.
2. Run **Manuscript check** and review its findings.
3. Confirm the book's title, subtitle, author, and chapter order.
4. Read the text and inspect any pictures that matter to your audience.
5. Export to a location you can find outside the app's data folder.
6. Open the file in the destination application.

Back matter and formatting differ across export formats. A 6×9-inch page size is not a guarantee that a publishing platform will accept the file. Use the destination service's current requirements when preparing print or commercial distribution.

## Send to Kindle with a mail app

1. Find your personal Send-to-Kindle address in your Amazon account's personal document settings.
2. In **Settings → Delivery & Send to Kindle**, select the mail-app method, enter the destination address, choose EPUB or PDF, and save.
3. Open the book and choose **Book tools → Send to Kindle**.
4. On macOS, review the Mail draft and attachment, then send it yourself.
5. On Windows, use the revealed file to attach it in your mail app or upload it through Amazon's [Send to Kindle](https://www.amazon.com/sendtokindle) service.

Amazon's delivery rules and approved-sender settings still apply. The mail-app method is a hand-off: it does not mean the app has confirmed delivery to your device.

## Send with SMTP

Choose **SMTP** in delivery settings if you want the app to send through your mail server. Enter your Kindle address, approved sender address, SMTP host, port, username, and password or provider app password. Save, then choose **Verify SMTP**.

Use the exact server settings supplied by your mail provider. A successful connection test establishes server access, not that Amazon accepted a particular document. For Kindle, ensure the sender is approved in your Amazon account. When you choose the send action, the manuscript and recipient are sent to your configured mail service.

## Email a PDF

Use the PDF email option from the reader when available. Review the destination address carefully. With configured SMTP, the app can send the attachment through that server; otherwise it uses the platform's mail/file hand-off.

SMTP credentials are stored with the app's encrypted settings. A manuscript attachment is still an ordinary copy in your mail system and your recipient's account. Deleting the library book does not recall sent messages.

## What you cannot import

The reader opens ChapterOne's own library books. It does not currently import arbitrary EPUBs or round-trip edited DOCX files back into the manuscript. Use manual chapter editing for text changes, and keep the exported file as a separate working copy if another editor is taking over.
