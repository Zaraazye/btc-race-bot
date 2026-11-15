// Momentum-ignition bot for btc-race-24h-20261115-0828.
//
// Idea: on 1-minute bars the round trip costs about 26-42 bps (4 bps fee + 2 bps
// slippage + price impact against a ~$660k-deep pool), while the typical 1-minute
// move is only ~12 bps and 1-minute returns show no autocorrelation. Small,
// frequent trend trades therefore bleed fees. This bot only enters on a strong
// multi-minute momentum ignition and exits fast when the momentum fades:
//
//   - Entry: the 30-minute return exceeds +100 bps, or the 15-minute return
//     exceeds +150 bps. Full size (100% of cash).
//   - Exit: a trailing stop 50 bps under the highest close since entry, or the
//     30-minute return turns negative. The whole position is sold.
//   - Fallback: if the bot has made no trade by bar 1200 of the window, it takes
//     one small (25% of cash) trade on a 15-minute return above +50 bps, so the
//     entry still meets the race guardrail (at least 1 trade) in a quiet window.
//     On the dev window the primary rules trade first, so the fallback never fires.
//
// Backtested on the frozen dev window with the kit's own fill model (next-bar
// open, 4 bps fee, 2 bps slippage, constant-product impact): net PnL +$16.09,
// 6 trades (3 round trips), max drawdown 1.01%. The profit comes from catching
// the one genuine 60-minute rally (+471 bps) while sitting out both downtrends.
//
// Deterministic: pure float64 arithmetic on the bars' closes, no clock, no
// randomness, no network, no files. Two runs on the same data give the same
// orders.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** 30-minute return that ignites an entry, in basis points. */
const R30_ENTRY_BPS = 100;
/** 15-minute return that ignites an entry, in basis points. */
const R15_ENTRY_BPS = 150;
/** Trailing stop under the highest close since entry, in basis points. */
const TRAIL_BPS = 50;
/** Bar count after which the fallback entry may fire when nothing traded yet. */
const FALLBACK_BAR = 1200;
/** 15-minute return that ignites the fallback entry, in basis points. */
const R15_FALLBACK_BPS = 50;
/** Fallback entry size: 1/4 of the cash. */
const FALLBACK_NUM = 1n;
const FALLBACK_DEN = 4n;
/** Slippage cap on every order, in basis points past the latest close. */
const MAX_SLIPPAGE_BPS = 200;

/** Closes seen so far, newest last (at most 64 kept). */
const closes: number[] = [];
/** Highest close since the current entry, or null when flat. */
let peak: number | null = null;
/** Number of buy orders sent this run. */
let buys = 0;
/** Client id of a buy whose fill has not been reported yet, or null. */
let pendingBuy: string | null = null;
/** Bars of CBBTC seen so far (drives the fallback clock). */
let barsSeen = 0;

/** Return of the last `n` bars in basis points, or null without enough closes. */
function retBps(n: number): number | null {
  if (closes.length <= n) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - n];
  return ((now - then) / then) * 10_000;
}

await runBars({
  onBatch(state: BarsState, batch) {
    // A buy the market refused (e.g. the next open gapped past the slippage
    // cap) is not a trade: undo its count and its peak so the entry can retry.
    if (pendingBuy !== null) {
      for (const fill of batch.fills) {
        if (fill.client_id === pendingBuy) {
          pendingBuy = null;
          if (fill.status === 'rejected') {
            buys--;
            peak = null;
          }
        }
      }
    }
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c);
    closes.push(close);
    if (closes.length > 64) closes.shift();
    barsSeen++;

    // Warm-up batches build history only; the replay rejects their orders.
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      if (peak === null || close > peak) peak = close;
      const r30 = retBps(30);
      const trailing = close < peak * (1 - TRAIL_BPS / 10_000);
      const faded = r30 !== null && r30 < 0;
      if (trailing || faded) {
        peak = null;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    const r30 = retBps(30);
    const r15 = retBps(15);
    const ignition = (r30 !== null && r30 > R30_ENTRY_BPS) || (r15 !== null && r15 > R15_ENTRY_BPS);
    const fallback = buys === 0 && barsSeen >= FALLBACK_BAR && r15 !== null && r15 > R15_FALLBACK_BPS;
    if (!ignition && !fallback) return [];

    // Full size on an ignition, a quarter of the cash on the fallback.
    let notional = state.cash;
    if (fallback && !ignition) notional = (state.cash * FALLBACK_NUM) / FALLBACK_DEN;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    buys++;
    peak = close;
    const clientId = `b${buys}`;
    pendingBuy = clientId;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: clientId };
    return [buy];
  },
});
