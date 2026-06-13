'use strict';

/** Assemble a full book into a single Markdown manuscript. */
function bookToMarkdown(book) {
  const lines = [];
  lines.push(`# ${book.title}`);
  if (book.subtitle) lines.push(`\n*${book.subtitle}*`);
  lines.push(`\n_by ${book.author || 'Anonymous'}_\n`);
  if (book.premise) lines.push(`\n> ${book.premise}\n`);
  lines.push('\n---\n');
  for (const c of book.chapters || []) {
    // Each chapter already begins with its own "# Title" heading.
    lines.push(c.content.trim());
    lines.push('\n\n---\n');
  }
  return lines.join('\n');
}

module.exports = { bookToMarkdown };
