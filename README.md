[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Zaraazye/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Zaraazye/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

# Confirmed Momentum — cbBTC 1-minute trading bot

Entry for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261115-0828) (make.fun). The bot trades Coinbase Wrapped BTC against USDC on 1-minute on-chain bars with $1,000 of paper money. Long only, no leverage.

## Strategy

A full-size round trip costs ~43 bps (4 bps fee + 2 bps slippage + ~16 bps
price impact each way at the pool's depth), so only multi-minute momentum
runs pay. Small signals churn and die: on the dev window the EMA-cross
baseline lost $134.95 on 63 trades, mean-reversion dip-buying lost $40.61
on 48 trades, and a lone 60-minute-return trigger lost $14.33 buying
dead-cat bounces inside the downtrend.

This bot buys only when momentum is confirmed on **two timeframes at once**:

- 15-minute return above **+130 bps** (ignition), **and**
- 60-minute return above **+50 bps** (not a bounce inside a waterfall), **and**
- 60-minute return at or above **-150 bps** (never buy into a waterfall).

It exits the whole position on a **50 bps trailing stop** from the highest
close since entry, a **negative 30-minute return**, or a **240-bar time stop**.

Guardrail insurance: if no trade has filled by bar 1200, it buys 25% of
cash on any positive 15-minute return; if still nothing by bar 1350, it
buys 25% unconditionally. The race ranks a zero-trade entry below every
entry that traded, so this guarantees the entry meets the bar.

All decisions use exact integer arithmetic on closes — no floats, no clock,
no randomness, no network. The same bars give the same orders every run.

## Verified results (official `grade-local`, dev window)

- Net PnL: **+$21.01** (dev gate: above $0 — passes)
- Trades: **2** (1 round trip, win rate 100%)
- Max drawdown: **0.81%** (limit 25%)
- Net PnL at 2x fees: **+$20.20**
- Deterministic: 3 local grades, identical action log
  (`a8306365c136f7a751bdc622fd57978a9fbd11af9a40e5d1ce3c973b1cbcc15c`)

## Files

- `main.ts` — the bot (Node 22, stdlib only)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit SDK shim
- `README.md`, `LICENSE`, `.makefun/owner.json`
