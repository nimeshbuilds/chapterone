'use strict';

const { classifyError, shouldFallback } = require('../book/errors');

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
        const kind = classifyError(err.message);
        if (!shouldFallback(kind)) throw err; // e.g. user cancellation
        const next = this.adapters[i + 1];
        if (next) {
          announce({
            type: 'falling-back',
            fromId: adapter.id, toId: next.id, kind,
            error: err.message,
          });
        } else {
          // No more adapters: the whole chain is exhausted.
          announce({ type: 'exhausted', fromId: adapter.id, kind, error: err.message });
        }
      }
    }
    throw lastErr;
  }
}

module.exports = { ChainEngine };
