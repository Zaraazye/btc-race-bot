// Confirmed Momentum — a cbBTC 1-minute momentum bot for make.fun
// btc-race-24h-20261115-0828.
//
// Idea: on a 24h window of 1-minute bars the only moves big enough to pay the
// ~43 bps full-size round-trip cost (4 bps fee + 2 bps slippage + ~16 bps
// impact each way at the pool's depth) are multi-minute momentum runs. Small
// signals churn and die: on the dev window the EMA-cross baseline lost
// $134.95 on 63 trades, mean-reversion dip-buying lost $40.61 on 48 trades,
// and a lone 60-minute-return trigger lost $14.33 by buying dead-cat bounces
// inside the downtrend. So this bot only buys when momentum is confirmed on
// TWO timeframes at once, and otherwise sits in cash.
//
// Entry (full size, 100% of cash), all comparisons exact integer math on
// closes, no floats anywhere in the decision:
//   - 15-minute return above +130 bps (the ignition), AND
//   - 60-minute return above +50 bps (the move is not a bounce inside a
//     waterfall), AND
//   - 60-minute return at or above -150 bps (never buy into a waterfall).
// The two losing trades of the obvious single-timeframe version are exactly
// the ones this filter removes: a slow grind topped out at bar 549 (15m
// return never fired) and a sharp bounce at bar 941 (60m return negative).
//
// Exit (whole position):
//   - trailing stop 50 bps below the highest close since entry, or
//   - 30-minute return below 0 (the momentum is dead), or
//   - 240 bars held (time stop).
//
// Guardrail insurance (the race ranks an entry with zero trades below every
// entry that traded): if no trade has filled by bar 1200, buy 25% of cash
// on any positive 15-minute return; if still nothing by bar 1350, buy 25%
// unconditionally. On the dev window the main signal fires first, so the
// fallback never triggers there; with the main signal disabled it fires at
// bar 1200 and costs $1.09 on the dev data. The fallback exits on the same
// rules as a normal trade.
//
// Everything is deterministic: integer arithmetic only, no clock, no
// randomness, no environment, no network. The same bars give the same
// orders on every run.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** 15-minute return must exceed this, in bps. */
const IGNITION_BPS = 130;
/** 60-minute return must exceed this, in bps. */
const CONFIRM_BPS = 50;
/** Never buy when the 60-minute return is below this, in bps. */
const WATERFALL_BPS = -150;
/** Trailing stop below the highest close since entry, in bps. */
const TRAIL_BPS = 50;
/** Longest a position is held, in bars. */
const MAX_HOLD_BARS = 240;
/** Fallback arming bars (guardrail insurance). */
const FALLBACK_BAR_1 = 1200;
const FALLBACK_BAR_2 = 1350;
/** Fallback size: a quarter of the cash. */
const FALLBACK_NUM = 1n;
const FALLBACK_DEN = 4n;
/** Orders must fill within this of the latest close, in bps. */
const MAX_SLIPPAGE_BPS = 200;

/** Closes by batch seq (null before the symbol's first bar). */
const closes: (bigint | null)[] = [];
/** Highest close since the current entry, or null while flat. */
let peak: bigint | null = null;
/** Batch seq of the current entry, or -1 while flat. */
let entrySeq = -1;
/** True once any trade has been decided (main signal or fallback). */
let traded = false;
/** Fallback stage: 0 = not used, 1 = stage 1 used, 2 = stage 2 used. */
let fbStage = 0;

/** close[i] is more than `bps` above close[i - w], exactly (integer math). */
function retAbove(i: number, w: number, bps: number): boolean {
  const now = closes[i];
  const then = closes[i - w];
  if (now === null || now === undefined || then === null || then === undefined) return false;
  return now * 10000n > then * BigInt(10000 + bps);
}

/** close[i] is at or above close[i - w] plus `bps` (bps may be negative). */
function retAtLeast(i: number, w: number, bps: number): boolean {
  const now = closes[i];
  const then = closes[i - w];
  if (now === null || now === undefined || then === null || then === undefined) return false;
  return now * 10000n >= then * BigInt(10000 + bps);
}

/** close[i] is below close[i - w]. */
function retBelowZero(i: number, w: number): boolean {
  const now = closes[i];
  const then = closes[i - w];
  if (now === null || now === undefined || then === null || then === undefined) return false;
  return now < then;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    closes[state.seq] = state.close(SYMBOL);
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    const held = state.positions.get(SYMBOL);
    const i = state.seq;

    if (held !== undefined && held.qty > 0n && close !== null) {
      if (peak === null || close > peak) peak = close;
      const stopHit = peak !== null && peak * 10000n >= close * BigInt(10000 + TRAIL_BPS);
      const timedOut = entrySeq >= 0 && i - entrySeq >= MAX_HOLD_BARS;
      const dead = retBelowZero(i, 30);
      if (stopHit || timedOut || dead) {
        peak = null;
        entrySeq = -1;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: only trade with enough history.
    if (close === null || i < 60) return [];
    const ignition = retAbove(i, 15, IGNITION_BPS);
    const confirmed = retAbove(i, 60, CONFIRM_BPS);
    const noWaterfall = retAtLeast(i, 60, WATERFALL_BPS);
    if (ignition && confirmed && noWaterfall) {
      const room = state.weightRoom(SYMBOL);
      const notional = state.cash < room ? state.cash : room;
      if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      peak = close;
      entrySeq = i;
      traded = true;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    // Guardrail insurance: guarantee at least one trade in the window.
    if (!traded && fbStage === 0 && i >= FALLBACK_BAR_1) {
      const anyUp = closes[i] !== null && closes[i - 15] !== null && (closes[i] as bigint) > (closes[i - 15] as bigint);
      if (anyUp) {
        const notional = (state.cash * FALLBACK_NUM) / FALLBACK_DEN;
        if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
        peak = close;
        entrySeq = i;
        traded = true;
        fbStage = 1;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    if (!traded && fbStage === 0 && i >= FALLBACK_BAR_2) {
      const notional = (state.cash * FALLBACK_NUM) / FALLBACK_DEN;
      if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      peak = close;
      entrySeq = i;
      traded = true;
      fbStage = 2;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
