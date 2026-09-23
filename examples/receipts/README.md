# Receipts — real output from a real run

These two files are **captured output, not fixtures.** Nothing in `src/` or `test/` reads them.
They exist so a judge without a Frontrun API key can still see what this tool actually produces.

| File | What it is |
|---|---|
| `report-card.sample.json` | The full machine-readable report card + paper backtest |
| `report-card.sample.html` | The same run rendered as the self-contained shareable page |

## How they were produced

**Captured from a live run on 2026-09-24 (03:50 WIB / 2026-09-23 20:50 UTC)** with:

```bash
node src/cli.js score-list examples/sample-calls.json --label sample-list --backtest
```

This is the **keyless path**: the call list supplies the contracts and call times, and everything
downstream is live network truth —

- **prices**: real hourly candles pulled from the public GeckoTerminal API at run time;
- **chain**: read-only Solana mainnet JSON-RPC (allow-listed methods only);
- **scoring / grading / backtest**: the same code paths a keyed `report` run uses.

Re-run the command above and you get the same structure against fresh candles. There is no mock
mode in this repo — if the network does not answer, the run fails instead of inventing numbers.

## What these receipts do **not** show

The **Frontrun** side. `caHistory`, `linkedWallets` and `walletLabels` need the hackathon API key,
which was not issued at the time of capture. In this run the call list stands in for `caHistory`;
`linkedWallets` is empty and the talk-vs-trade check therefore has nothing to flag.

A keyed run replaces exactly one step — where the call list comes from — and populates the linked
wallets and labels. Everything you see scored here is scored by the identical code.

## Numbers in this capture

10 calls in, 9 scored, 1 unscored (no usable candles for that pool in the window), 5 hits,
55.6% hit rate at the 24 h headline horizon. Nine of ten is a small sample and the report card
labels itself `low-sample` for exactly that reason.

> Backwards-looking measurement of what already happened. Simulation only, paper trading only,
> **not financial advice.**
