'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { sendEmailWithAttachment, sendToKindle } = require('../src/main/kindle/sendToKindle');

const goodSmtp = { host: 'smtp.test', port: 587, user: 'u', pass: 'p' };

test('rejects incomplete SMTP', async () => {
  await assert.rejects(
    sendEmailWithAttachment({ smtp: { host: 'x' }, from: 'a@b.c', to: 'd@e.f', filePath: '/tmp/x' }),
    /SMTP settings are incomplete/
  );
});

test('requires a from address', async () => {
  await assert.rejects(
    sendEmailWithAttachment({ smtp: goodSmtp, to: 'd@e.f', filePath: '/tmp/x' }),
    /from" email/
  );
});

test('validates the recipient email', async () => {
  await assert.rejects(
    sendEmailWithAttachment({ smtp: goodSmtp, from: 'a@b.c', to: 'not-an-email', filePath: '/tmp/x' }),
    /valid recipient/
  );
});

test('requires an existing file', async () => {
  await assert.rejects(
    sendEmailWithAttachment({ smtp: goodSmtp, from: 'a@b.c', to: 'd@e.f', filePath: '/no/such/file.pdf' }),
    /does not exist/
  );
});

test('sendToKindle enforces an @kindle.com address', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'em-')), 'b.epub');
  fs.writeFileSync(f, 'x');
  await assert.rejects(
    sendToKindle({ smtp: goodSmtp, from: 'a@b.c', to: 'someone@gmail.com', filePath: f, title: 'T' }),
    /@kindle\.com/
  );
});

test('composeInMail rejects when the file is missing', async () => {
  const { composeInMail } = require('../src/main/kindle/sendToKindle');
  await assert.rejects(
    composeInMail({ to: 'a@kindle.com', subject: 's', body: 'b', filePath: '/no/such/file.epub' }),
    /does not exist|only available on macOS/
  );
});
