'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const nodemailer = require('nodemailer');

const SIGNATURE = 'Sent via ChapterOne — Your Personal Book Writer.';

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
    text: text || `Your book "${filename}" is attached. ${SIGNATURE}`,
    attachments: [{ filename, path: filePath }],
  });
  return { messageId: info.messageId, accepted: info.accepted || [], method: 'smtp' };
}

/**
 * Send a document to a reader's Send-to-Kindle (@kindle.com) address via SMTP.
 * The sending address must be on Amazon's Approved Personal Document E-mail List.
 */
async function sendToKindle(opts) {
  const { to, title } = opts;
  if (!to || !/@kindle\.com$/i.test(String(to).trim())) {
    throw new Error('The Kindle address must end in @kindle.com.');
  }
  return sendEmailWithAttachment({
    ...opts,
    subject: title || 'Your book',
    text: `Your book "${title || ''}" is attached. ${SIGNATURE}`,
  });
}

/** Verify SMTP credentials without sending anything. */
async function verifySmtp(smtp) {
  await buildTransport(smtp).verify();
  return { ok: true };
}

// ---- No-credential delivery: hand the message off to the Mail app ----

/** Quote a string for safe embedding inside an AppleScript double-quoted literal. */
function asQuote(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Open the macOS Mail app composing a new message, pre-filled with the
 * recipient, subject and body, and the book file already attached. The user
 * just presses Send — no SMTP credentials required. macOS only.
 * @param {object} opts { to, subject, body, filePath }
 */
function composeInMail({ to, subject, body, filePath }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      return reject(new Error('Mail hand-off is only available on macOS.'));
    }
    if (!filePath || !fs.existsSync(filePath)) {
      return reject(new Error('The document to send does not exist.'));
    }
    const recipientLine = to
      ? `make new to recipient at end of to recipients with properties {address:${asQuote(to)}}`
      : '';
    const script = [
      'tell application "Mail"',
      `  set newMessage to make new outgoing message with properties {subject:${asQuote(subject || 'Your book')}, content:${asQuote((body || '') + '\n\n')}, visible:true}`,
      '  tell newMessage',
      `    ${recipientLine}`,
      `    make new attachment with properties {file name:(POSIX file ${asQuote(filePath)})} at after the last paragraph of content`,
      '  end tell',
      '  activate',
      'end tell',
    ].join('\n');
    execFile('osascript', ['-e', script], (err, _stdout, stderr) => {
      if (err) return reject(new Error(`Could not open Mail: ${stderr || err.message}`));
      resolve({ method: 'mail', composed: true });
    });
  });
}

module.exports = { sendToKindle, sendEmailWithAttachment, verifySmtp, composeInMail, SIGNATURE };
