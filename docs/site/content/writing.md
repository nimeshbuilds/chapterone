## Write a brief with useful constraints

A good brief tells the app what the reader should experience or learn. Include enough direction to distinguish your book from a generic treatment of the topic.

| For fiction | For nonfiction |
| --- | --- |
| Audience and genre | Intended reader and starting knowledge |
| Main character, desire, and obstacle | The practical problem or central question |
| Setting and tone | Topics to include and exclude |
| Stakes and ending preferences | Desired depth, examples, and exercises |
| Content boundaries | Facts or claims that need particular care |

Describe the qualities you want in the prose: restrained, funny, conversational, precise, lyrical, or fast-paced. Give examples of structure and tone in your own words. You can use the idea prompts in New Book to get past a blank page, then edit them into your own brief.

## Choose the book settings

**Kind** guides fiction versus nonfiction. **Size** controls the requested scope; the displayed page ranges are estimates, not a guaranteed final count. Typography, chapter length, illustrations, and export format all affect pagination.

**Author name** controls the book's author metadata. **Research** lets supported providers use web tools for grounding. **Editor pass** adds an AI revision after chapter drafting and therefore increases work and provider usage. Neither is a substitute for human editing or fact checking.

**Illustrations** are optional. Start text-only if the writing is your priority. See [illustration choices](illustrations.md) for the difference between writing-engine art and image API generation.

## Review the chapter map

Enable **Review the chapter plan before writing begins** if you want control over the structure before the full draft. Once the plan is ready, you can edit chapter titles and summaries or remove chapters.

Work from the whole book down to each chapter:

1. Check that the opening establishes the right promise.
2. Look for repetition and missing transitions in the middle.
3. Make sure the ending resolves the story or delivers the promised outcome.
4. Make each summary explain what changes or what the reader gains.
5. Choose **Approve & start writing** when the plan is ready.

The outline is saved before drafting. Research and planning may already have consumed provider quota by the time you see it. A chapter summary is an instruction, not a hard guarantee that the model will follow every detail.

## Understand the progress screen

The app moves through planning, cover work when enabled, chapter drafting, optional editing, optional illustration, and finishing touches. The activity log tells you which phase is running and whether a retry or provider switch occurred.

Completed chapter text is saved before its optional artwork. A missing illustration should not erase the chapter. The previous chapter's compact continuity recap helps the next chapter keep context; the provider does not receive an unlimited, perfect memory of the entire book.

You can read saved chapters while the rest are generated. Open the reader, then use **Load new** to bring newly saved chapters into that reader session. Navigating between views does not stop the main writing job.

## Pause and continue

Use the writing pause/cancel control to stop an active request. Your completed chapters remain in the library. Select **Continue** on the paused book to resume from the next saved chapter.

Checkpointing happens after completed work. Text still streaming from a model, an unfinished editor pass, and unsaved changes in a form are not durable chapter checkpoints. A stopped or crashed request may need to be run again and may consume provider usage again.

After an app restart, an interrupted book is recovered as a paused draft when saved outline or chapter data exists. Resume does not automatically regenerate every missing illustration. See [recovery](backups.md#recover-interrupted-writing) if progress looks incomplete.

## Keep changes coordinated

Only one generation, resume, or AI rewrite job runs at a time. Editing and destructive actions may be blocked while the app is writing, exporting, narrating, or delivering a book, so a later background save cannot silently overwrite your change.

If an operation is blocked, finish or stop the active writing job and wait for other active operations to settle. Repeatedly clicking the action will not make it safer or faster.

## Finish with a human review

Read the entire draft before sharing it. Use [revision history](revisions.md) when trying substantial changes and run **Manuscript check** to identify practical cleanup work. For factual material, verify claims against reliable sources and add the citations the book actually needs. Research grounding does not produce a verified bibliography.
