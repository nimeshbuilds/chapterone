'use strict';

const https = require('https');

/** Bounded HTTPS requests that also settle when a response is cut off mid-body. */
function requestBuffer(options, { body, signal, timeoutMs = 120000, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Aborted before start'));
    let timer;
    const req = https.request({ ...options, signal }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) req.destroy(new Error('Provider response exceeded the size limit.'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Provider connection lost mid-response.')));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks) }));
    });
    timer = setTimeout(() => req.destroy(new Error('Provider request timed out.')), timeoutMs);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(body);
  });
}

module.exports = { requestBuffer };
