'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

function buildTransport(smtp) {
  if (!smtp || !smtp.host) throw new Error('SMTP host is required. Configure it in Settings.');
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: smtp.secure != null ? !!smtp.secure : Number(smtp.port) === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

/**
 * Generic: email a file as an attachment through the user's own SMTP account.
 * @param {object} opts { smtp, from, to, filePath, subject, text }
 */
async function sendEmailWithAttachment(opts) {
  const { smtp, from, to, filePath, subject, text } = opts;
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
    throw new Error('SMTP settings are incomplete. Configure host, username and password in Settings.');
  }
  if (!from) throw new Error('A verified "from" email address is required (set it in Settings).');
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to).trim())) {
    throw new Error('Please provide a valid recipient email address.');
  }
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('The document to send does not exist.');
  }
  const filename = path.basename(filePath);
  const info = await buildTransport(smtp).sendMail({
    from,
    to: String(to).trim(),
    subject: subject || filename,
    text: text || `Your book "${filename}" is attached. Sent via Modulagent's Book Writer.`,
    attachments: [{ filename, path: filePath }],
  });
  return { messageId: info.messageId, accepted: info.accepted || [] };
}

/**
 * Send a document to a reader's Send-to-Kindle (@kindle.com) address. The
 * sending address must be on Amazon's Approved Personal Document E-mail List.
 */
async function sendToKindle(opts) {
  const { to, title } = opts;
  if (!to || !/@kindle\.com$/i.test(String(to).trim())) {
    throw new Error('The Kindle address must end in @kindle.com.');
  }
  return sendEmailWithAttachment({
    ...opts,
    subject: title || 'Your book',
    text: `Your book "${title || ''}" is attached. Sent via Modulagent's Book Writer.`,
  });
}

/** Verify SMTP credentials without sending anything. */
async function verifySmtp(smtp) {
  await buildTransport(smtp).verify();
  return { ok: true };
}

module.exports = { sendToKindle, sendEmailWithAttachment, verifySmtp };
