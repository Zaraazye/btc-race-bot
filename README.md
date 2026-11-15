# Momentum Ignition — btc-race-24h-20261115-0828

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Zaraazye/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Zaraazye/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A BTC trading bot for make.fun's `btc-race-24h-20261115-0828`: it trades
Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, long only,
$1,000 of paper money.

## Strategy

On 1-minute bars a full round trip costs about 26–42 bps (4 bps fee + 2 bps
slippage + price impact against a ~$660k-deep pool), while the typical 1-minute
move is only ~12 bps and 1-minute returns show no autocorrelation. Small,
frequent trend trades therefore bleed fees. This bot only enters on a strong
multi-minute momentum ignition and exits fast when the momentum fades:

- **Entry:** the 30-minute return exceeds +100 bps, or the 15-minute return
  exceeds +150 bps. Full size (100% of cash).
- **Exit:** a trailing stop 50 bps under the highest close since entry, or the
  30-minute return turns negative. The whole position is sold.
- **Fallback:** if the bot has made no trade by bar 1200 of the window, it takes
  one small (25% of cash) trade on a 15-minute return above +50 bps, so the
  entry still meets the race guardrail (at least 1 trade) in a quiet window.
  On the dev window the primary rules trade first, so the fallback never fires.

## Dev-window grade (official grader, `grade-local --driver process`)

- Net PnL: **+$16.08** (gate: > $0 — passes)
- Return: +1.61%
- Trades: 6 (3 round trips)
- Max drawdown: 1.01% (limit: 25%)
- Net PnL at 2x fees: +$13.66 (still positive with fees doubled)
- Result SHA256: `2ed858c93c96e1bf37f28db77dd283c62560b2743d97a9296101ed6be1c7d0a4`

The profit comes from catching the one genuine 60-minute rally (+471 bps)
while sitting out both downtrends of the window.

## Files

- `main.ts` — the bot (Node 22, standard library only via the kit shim)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `.makefun/owner.json` — claim file naming the payout wallet

## License

MIT — see `LICENSE`.
