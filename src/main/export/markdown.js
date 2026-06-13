'use strict';

/** Assemble a full book into a single Markdown manuscript. */
function bookToMarkdown(book) {
  const lines = [];
  lines.push(`# ${book.title}`);
  if (book.subtitle) lines.push(`\n*${book.subtitle}*`);
  lines.push(`\n_by ${book.author || 'Anonymous'}_\n`);
  if (book.premise) lines.push(`\n> ${book.premise}\n`);
  lines.push('\n---\n');
  for (const c of (book.chapters || []).filter(Boolean)) {
    // Each chapter already begins with its own "# Title" heading.
    // Internal image refs become a readable placeholder in plain Markdown.
    lines.push(c.content.replace(/!\[([^\]]*)\]\(bwimg:[^)]+\)/g, '*[Image: $1]*').trim());
    lines.push('\n\n---\n');
  }
  if ((book.images || []).some((im) => im && im.attribution)) {
    lines.push('\n## Image Credits\n');
    for (const im of book.images) {
      if (im && im.attribution) lines.push(`- ${im.caption || im.query}: ${im.attribution} (${(im.license || '').toUpperCase()})`);
    }
  }
  return lines.join('\n');
}

module.exports = { bookToMarkdown };
