## Find a book in your library

The library holds finished books and paused drafts. Search by **title, author, or genre**, filter by status, and change the sort order to find the manuscript you need. Use Tiles for cover browsing or List when you want to scan the metadata. The library's continuation card brings your most recent work forward. Audience labels describe the intended category; they do not certify content suitability.

Open a book to read it. Choose **Continue** on a paused draft when you want writing to resume. A saved draft can still be read or exported even if generation did not finish.

## Make the reader comfortable

Use **Contents** to jump to a chapter. The reader also includes previous/next navigation, type-size controls, font choices, Light/Sepia/Night themes, and Page/Scroll modes. Reader preferences and position are remembered locally.

Changing the reader's display is not the same as editing the book or configuring every export's layout. Open exported files separately to inspect their actual appearance.

If the book is still being written, a live banner reports new saved chapters. Choose **Load new** to refresh the reader's chapter list. You can keep reading while generation continues.

## Edit a chapter by hand

1. Navigate to a chapter rather than the cover or title page.
2. Choose **Edit**.
3. Change the chapter's Markdown.
4. Choose **Save chapter**.
5. Read the result and export again if you need an updated file.

Common Markdown examples:

```markdown
## A scene heading

A paragraph with **bold emphasis** and *italics*.

- A short list item
- Another item
```

Manual editing is local and does not call a writing provider. Saved edits flow into future reader views, exports, and narration. Existing files you already exported are independent copies and do not change automatically.

Before the current prose is replaced, ChapterOne saves it to that chapter's bounded [revision history](revisions.md). If you close an edit dialog without saving, its unsaved text is not a history version.

## Ask for a focused rewrite

Choose **Rewrite** on the chapter and describe the desired change. State what should remain as well as what should improve. For example:

> Preserve the evidence, point of view, and ending. Cut repeated explanations, make the dialogue more natural, and keep the chapter within roughly the current length.

A rewrite replaces that chapter's prose and uses the configured writing provider chain. The previous prose is saved in revision history. It does not automatically rewrite later chapters to account for every new fact, so check continuity yourself.

## Rename the book and set the author

Open **Book tools → Title & author** in the reader to edit the title, subtitle, and author. Saving metadata affects future exports. It does not rename files that you already saved elsewhere or rewrite references inside chapter prose.

## Use the story bible and stats

Open **Book tools → Story bible** for planning information such as the premise, style guide, cast, and chapter map. Use it as a reference while checking consistency. It reflects generated planning artifacts; it is not a guarantee that every chapter obeys them.

**Book tools → Stats** summarizes words, estimated pages and reading time, and reading-level heuristics. These are estimates. Reading-level formulas are particularly limited for dialogue, poetry, code, short text, and languages other than English.

Before sharing, open **Manuscript check** for actionable structural and text-cleanup findings. See [what the check does](revisions.md#run-a-manuscript-check) and what still needs editorial judgment.

## Start a sequel

On a finished library book, choose **Write the sequel**. ChapterOne prefills a new brief using the previous book's world, cast, reference photos, and voice. Review and adjust the brief before generating.

A sequel is a new book with its own saved draft and exports. Read the previous ending and important continuity facts yourself; a prefilled brief is a starting point, not a complete shared memory across books.

## Keep a copy before deleting

Deleting a book removes its app-managed manuscript, artwork, audio, and chapter history. Export or [back up](backups.md) anything you want to keep first. Independent exported copies are not removed when you delete the library book.
