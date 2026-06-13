'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

/**
 * Send a document (EPUB/PDF) to a reader's Send-to-Kindle email address.
 *
 * Amazon's Send-to-Kindle works by emailing a supported document as an
 * attachment to the user's "@kindle.com" address. The SENDING email address
 * must be on the user's Amazon "Approved Personal Document E-mail List".
 *
 * We use the reader's own SMTP credentials (e.g. a Gmail app password) so no
 * third-party server ever sees their content.
 *
 * @param {object} opts
 * @param {object} opts.smtp        { host, port, secure, user, pass }
 * @param {string} opts.from        Approved sender address.
 * @param {string} opts.to          The @kindle.com address.
 * @param {string} opts.filePath    Path to the EPUB/PDF to send.
 * @param {string} [opts.title]     Book title (used in subject/filename).
 * @returns {Promise<{messageId:string, accepted:string[]}>}
 */
async function sendToKindle(opts) {
  const { smtp, from, to, filePath, title } = opts;

  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
    throw new Error('SMTP settings are incomplete. Configure host, user and password in Settings.');
  }
  if (!from) throw new Error('A verified "from" email address is required.');
  if (!to || !/@kindle\.com$/i.test(to.trim())) {
    throw new Error('The Kindle address must end in @kindle.com.');
  }
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('The document to send does not exist. Export it first.');
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: smtp.secure != null ? !!smtp.secure : Number(smtp.port) === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });

  const filename = path.basename(filePath);
  const info = await transporter.sendMail({
    from,
    to: to.trim(),
    // Amazon uses the subject "Convert" to auto-convert some formats; for EPUB
    // it is delivered as-is. A descriptive subject is fine.
    subject: title || filename,
    text: `Your book "${title || filename}" is attached. Sent via BookWriter Studio.`,
    attachments: [{ filename, path: filePath }],
  });

  return { messageId: info.messageId, accepted: info.accepted || [] };
}

/** Verify SMTP credentials without sending anything. */
async function verifySmtp(smtp) {
  if (!smtp || !smtp.host) throw new Error('SMTP host is required.');
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: smtp.secure != null ? !!smtp.secure : Number(smtp.port) === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transporter.verify();
  return { ok: true };
}

module.exports = { sendToKindle, verifySmtp };
