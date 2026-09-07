/**
 * What a key costs in dollars, from a real rate or not at all.
 *
 * The contract prices in the chain's native asset and that is the only figure
 * a wallet ever signs. A dollar figure beside it is a convenience, and the
 * moment it is invented it stops being one: a price that reads $2.00 while the
 * rate is stale is a number a buyer acted on. So there is no fallback rate and
 * no last-known-good — a fetch that fails returns null, the page prints no
 * dollar figure, and nobody is told a price that nothing produced.
 *
 * Cached for five minutes because the mint panel is polled and the rate moves
 * far more slowly than the panel refreshes.
 */
const SPOT = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const TTL_MS = 5 * 60_000;

export class EthUsd {
  constructor({ url = SPOT, ttlMs = TTL_MS, fetchImpl = globalThis.fetch,
                now = Date.now, log = console.log } = {}) {
    Object.assign(this, { url, ttlMs, now, log });
    this.fetch = fetchImpl;
    this.at = 0;
    this.value = null;
  }

  /** A number, or null for "we do not know". Never throws, never guesses. */
  async rate() {
    if (this.value !== null && this.now() - this.at < this.ttlMs) return this.value;
    try {
      const r = await this.fetch(this.url, { signal: AbortSignal.timeout(4000) });
      const j = await r.json();
      const n = Number(j?.data?.amount);
      // A rate that is not a positive finite number is not a rate. Zero would
      // print every key as free, which is the one thing a price must never say
      // by accident.
      if (!Number.isFinite(n) || n <= 0) throw new Error(`bad amount: ${j?.data?.amount}`);
      this.value = n; this.at = this.now();
      return n;
    } catch (e) {
      // Stale is worse than absent here: the panel simply drops the dollar line.
      this.value = null;
      this.log(`[usd] ETH/USD unreadable — ${String(e.message ?? e)}`);
      return null;
    }
  }
}
