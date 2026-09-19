'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const UI_URL = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href;

/** Only the app's top-level document may use the privileged preload bridge. */
function isTrustedSender(event) {
  const frame = event && event.senderFrame;
  return !!(frame && event.sender && frame === event.sender.mainFrame && frame.url === UI_URL);
}

function isExternalUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch (_) { return false; }
}

/** Offline rendering must not read local files embedded by model-authored art. */
function configureOfflineSession(session, allowedFile) {
  let input;
  try { if (allowedFile) input = fs.realpathSync.native(allowedFile); } catch (_) { /* fail closed */ }
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    let localDocument = false;
    if (input && details.resourceType === 'mainFrame') {
      try {
        const url = new URL(details.url);
        if (url.protocol === 'file:' && !url.hostname) {
          const file = fileURLToPath(url);
          // Resolve Windows short names and URL normalization without allowing
          // UNC/network volumes or a different file to become an input document.
          if (!file.startsWith('\\\\') && path.parse(file).root.toLowerCase() === path.parse(input).root.toLowerCase()) {
            localDocument = fs.realpathSync.native(file) === input;
          }
        }
      } catch (_) { /* malformed, missing or disallowed local path */ }
    }
    callback({ cancel: !(localDocument || /^(data:|about:blank$)/i.test(details.url)) });
  });
}

module.exports = { UI_URL, isTrustedSender, isExternalUrl, configureOfflineSession };
