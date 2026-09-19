'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

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
  const input = allowedFile ? pathToFileURL(allowedFile).href : null;
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    const localDocument = details.resourceType === 'mainFrame' && details.url === input;
    callback({ cancel: !(localDocument || /^(data:|about:blank$)/i.test(details.url)) });
  });
}

module.exports = { UI_URL, isTrustedSender, isExternalUrl, configureOfflineSession };
