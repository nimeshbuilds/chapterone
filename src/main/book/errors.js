'use strict';

/**
 * Classify a CLI/engine failure so the app can react: pause & offer resume
 * when a subscription lapses, surface auth problems, etc.
 * @param {string} message
 * @returns {'subscription'|'auth'|'rate_limit'|'network'|'cancelled'|'unknown'}
 */
function classifyError(message) {
  const m = String(message || '').toLowerCase();
  if (/cancel|abort/.test(m)) return 'cancelled';
  if (/(credit|quota|insufficient|billing|payment required|subscription|plan limit|usage limit|out of (credit|usage)|upgrade)/.test(m)) {
    return 'subscription';
  }
  if (/(unauthor|authenticat|not logged in|please run .*login|invalid api key|invalid_api_key|forbidden|401|403|expired|invalid token|no credentials)/.test(m)) {
    return 'auth';
  }
  if (/(rate limit|rate_limit|429|overloaded|too many requests)/.test(m)) {
    return 'rate_limit';
  }
  if (/(timed out|timeout|etimedout|enotfound|econnreset|econnrefused|socket hang up|network|getaddrinfo|dns)/.test(m)) {
    return 'network';
  }
  return 'unknown';
}

/** A paused book can be resumed for these failure kinds. */
function isResumable(kind) {
  return ['subscription', 'auth', 'rate_limit', 'network', 'unknown'].includes(kind);
}

/** Human-friendly explanation + suggested action. */
function describe(kind) {
  switch (kind) {
    case 'subscription':
      return 'Your AI subscription appears to be out of credit or inactive. Your book is saved — reactivate your plan and hit Continue.';
    case 'auth':
      return 'The CLI is not signed in (or the session expired). Sign back into your subscription, then hit Continue.';
    case 'rate_limit':
      return 'The provider is rate-limiting requests right now. Your progress is saved — wait a moment and hit Continue.';
    case 'network':
      return 'A network problem interrupted writing. Your progress is saved — check your connection and hit Continue.';
    case 'cancelled':
      return 'Generation was cancelled. You can continue from where it stopped.';
    default:
      return 'Writing was interrupted, but your progress is saved. You can continue from where it stopped.';
  }
}

module.exports = { classifyError, isResumable, describe };
