'use strict';

const { classifyError, shouldFallback } = require('../book/errors');

/** Sleep that resolves early if the signal aborts — so Cancel is responsive
 *  even while we're waiting out a retry backoff. */
const delay = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const t = setTimeout(done, ms);
  const onAbort = () => done();
  function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); resolve(); }
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

/**
 * An engine that wraps an ordered list of provider adapters and provides an
 * automated fallback chain. When the active adapter fails for a reason worth
 * retrying (quota/subscription exhausted, auth, rate limit, network, etc.) it
 * transparently advances to the next adapter and retries the same request — so
 * a book keeps writing across providers without losing progress.
 *
 * The active provider is "sticky": once it advances to a working adapter it
 * stays there for subsequent calls (a dead quota won't recover mid-book), but
 * each call still starts from the current active index forward.
 */
class ChainEngine {
  /**
   * @param {Array<object>} adapters  Ordered adapters, each with .complete().
   * @param {object} [opts]
   * @param {(info:object)=>void} [opts.onSwitch]  Notified on every switch.
   */
  constructor(adapters, opts = {}) {
    if (!adapters || !adapters.length) throw new Error('ChainEngine needs at least one adapter');
    this.adapters = adapters;
    this.index = 0;
    this.onSwitch = opts.onSwitch || (() => {});
  }

  get active() { return this.adapters[this.index]; }
  get id() { return this.active ? this.active.id : 'none'; }
  get model() { return this.active ? this.active.model : ''; }

  /** Provider ids in this chain, for display. */
  chainIds() { return this.adapters.map((a) => a.id); }

  async detect() { return this.active.detect(); }
  async checkAuth() { return this.active.checkAuth(); }

  async complete(prompt, opts = {}) {
    // Optional, non-essential calls (illustrations, image queries) pass
    // `quiet: true` so a failure there falls back silently and never raises the
    // alarming "all engines failed" banner — the caller treats it as best-effort.
    const announce = opts.quiet ? () => {} : this.onSwitch;
    let lastErr = null;
    for (let i = this.index; i < this.adapters.length; i++) {
      const adapter = this.adapters[i];
      let kind = 'unknown';
      // Retry TRANSIENT (network / rate-limit / transient-server) failures on the
      // SAME adapter with backoff before giving up. Cloud CLIs (e.g. Grok's
      // proxy) blip and throttle; a single-engine chain has nothing to fall back
      // to, so we ride it out with several attempts and kind-aware waits.
      const MAX_ATTEMPTS = 5;
      // ms to wait before each retry, indexed by attempt-1. Rate limits need
      // longer to clear than a momentary network blip.
      const BACKOFF = { network: [1500, 4000, 8000, 15000], rate_limit: [5000, 12000, 24000, 40000] };
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const out = await adapter.complete(prompt, opts);
          if (i !== this.index) {
            // We recovered on a later adapter — make it the new active one.
            const from = this.adapters[this.index];
            this.index = i;
            announce({ type: 'switched', fromId: from.id, toId: adapter.id, model: adapter.model });
          }
          return out;
        } catch (err) {
          lastErr = err;
          kind = classifyError(err.message);
          if (!shouldFallback(kind)) throw err; // e.g. user cancellation
          // Network blips: always retry here (switching engines won't fix a local
          // hiccup). Rate limits: only retry if this is the LAST engine — when a
          // fallback exists, switch to it immediately instead of waiting.
          const isLast = !this.adapters[i + 1];
          const transient = kind === 'network' || (kind === 'rate_limit' && isLast);
          const aborted = opts.signal && opts.signal.aborted;
          if (transient && attempt < MAX_ATTEMPTS && !aborted) {
            announce({ type: 'retrying', id: adapter.id, kind, attempt, error: err.message });
            await delay((BACKOFF[kind] || BACKOFF.network)[attempt - 1] || 15000, opts.signal);
            if (opts.signal && opts.signal.aborted) throw err; // user cancelled during backoff
            continue;
          }
          break; // out of retries for this adapter — fall through to the next
        }
      }
      const next = this.adapters[i + 1];
      if (next) {
        announce({ type: 'falling-back', fromId: adapter.id, toId: next.id, kind, error: lastErr && lastErr.message });
      } else {
        // No more adapters: the whole chain is exhausted.
        announce({ type: 'exhausted', fromId: adapter.id, kind, error: lastErr && lastErr.message });
      }
    }
    throw lastErr;
  }
}

module.exports = { ChainEngine };
