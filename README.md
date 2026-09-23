# Called It

**Score every contract a Crypto Twitter account called, against what the price actually did — then check that account's linked wallets on-chain.**

Built for the [Called It hackathon](https://hackalaunch.com/h/called-it) on HackaLaunch.

Follower counts tell you who is loud. They do not tell you who is right. Called It takes a handle,
pulls every contract address that handle has posted from the **Frontrun Data API**, prices each call
against **real historical candles**, and asks a second question that the timeline never answers:
*do the wallets Frontrun links to that account actually hold what they told you to buy?*

Out comes a report card — hit rate, median return, peak, trough, per-call detail — plus a paper
backtest that shows what copying those calls would really have cost you after fees and slippage.

```
-- CALLED IT - report card for @someone ---------------------------------------

grade B   hit rate +58.3%   median 24h +12.4%   median peak +41.0%
calls 40  scored 31  unscored 9  confidence ok

-- scored calls ---------------------------------------------------------------
when (UTC)        token   24h      peak     trough   hold?
----------------  ------  -------  -------  -------  -----
2026-09-19 14:05  WIF     +62.1%   +88.4%   -9.2%    yes
2026-09-18 09:40  BONK    -14.7%   +3.1%    -22.0%   NO
...
```

---

## What it does

| Layer | Source | Why |
|---|---|---|
| **Social signal** | Frontrun `caHistory`, `linkedWallets`, `walletLabels`, `trendingAccounts`, `smartFollowers`, `mentionedWallets`, `pnlLeaderboard` | What the account said, and who they are on-chain |
| **On-chain truth** | Solana JSON-RPC, read-only | Do the linked wallets still hold the token they called |
| **Receipts** | GeckoTerminal public OHLCV | What the price actually did, hour by hour |

### Which Frontrun endpoints, and why

The brief asks for at least one social endpoint and at least one wallet endpoint. Called It uses
**all seven**, and `npm run doctor` prints exactly which ones answered on your key.

| Logical endpoint | Kind | Used for |
|---|---|---|
| `caHistory` | social | The core input: every contract this handle has posted, with a timestamp. Each row becomes one scored call. |
| `linkedWallets` | wallet | The wallets publicly connected to the handle. These are the addresses we then check on-chain. |
| `walletLabels` | wallet | Classifies those wallets, so a report card says *who* is calling, not just *what*. |
| `trendingAccounts` | social | `called-it trending` — a shortlist of handles worth report-carding right now. |
| `smartFollowers` | social | Context on a handle's audience quality; surfaced through the MCP server. |
| `mentionedWallets` | wallet | Wallets an account name-drops but is not linked to — a second lead for the talk-vs-trade check. |
| `pnlLeaderboard` | wallet | Ranks wallets by realised PnL, so a linked wallet can be placed against the best traders on the chain. |

### The talk-vs-trade check

For every Solana call, Called It asks the chain whether the account's linked wallets currently hold
that mint (`getTokenAccountsByOwner`, read-only). A call that went well while the caller's linked
wallets hold **none** of it today is flagged. A current balance is evidence, not proof of a sale —
the report says so, and links the wallet so you can look yourself.

---

## Install and run

Requirements: **Node 20.11+**. No other dependencies — this repo has an empty `dependencies` block on
purpose. A tool that holds an API key should have the smallest supply chain you can give it.

```bash
git clone https://github.com/<owner>/called-it.git
cd called-it
cp .env.example .env          # then paste your Frontrun key into FRONTRUN_API_KEY
npm test                      # 76 offline tests, no network
npm run doctor                # probe every Frontrun endpoint with your key
```

Then:

```bash
node src/cli.js report <handle>                  # report card
node src/cli.js backtest <handle>                # report card + paper backtest
node src/cli.js trending --limit 25              # Frontrun trending accounts
node src/cli.js wallet <address>                 # Frontrun labels for one wallet
node src/cli.js serve                            # view generated reports at 127.0.0.1:8788
npm run test:live                                # tests that hit the real network
```

Every run also writes `out/<handle>.html` (a self-contained, shareable report card) and
`out/<handle>.json` (everything, machine-readable).

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--max-calls N` | 40 | How many recent calls to score |
| `--horizon H` | 24 | Headline horizon in hours |
| `--entry-delay M` | 5 | Minutes between the tweet and your fill |
| `--no-wallets` | off | Skip the on-chain holdings check |
| `--json` | off | Machine-readable output |
| `--bankroll / --position / --fee-bps / --slippage-bps` | 1000 / 100 / 30 / 100 | Paper backtest settings |

### As an MCP server

```bash
npm run mcp
```

Speaks MCP over stdio with three read-only tools — `kol_report_card`, `frontrun_trending`,
`wallet_xray` — so Claude or any MCP client can ask for a report card in plain language. There is no
tool that places an order and no tool that returns your key.

```jsonc
// claude_desktop_config.json
{
  "mcpServers": {
    "called-it": {
      "command": "node",
      "args": ["C:/path/to/called-it/src/mcp/server.js"],
      "env": { "FRONTRUN_API_KEY": "your-key" }
    }
  }
}
```

---

## The endpoint map (read this if `doctor` fails)

The Frontrun Data API reference is Gold/hackathon-gated, so **no endpoint path, query parameter or
response field name is hard-coded anywhere in `src/`**. They all live in one file:

```
config/frontrun.endpoints.json
```

Each endpoint declares its `path`, its `query` template, a list of candidate `select` paths to the
array in the response, and a `fieldMap` of candidate source keys per normalised field. The client
matches keys case- and punctuation-insensitively and falls back to auto-detecting the largest array
in the payload, so it already survives `ca` vs `contract_address` vs `contractAddress`, and
`tweeted_at` vs `createdAt` vs a millisecond timestamp. This is covered by a test that feeds the same
call through three different response shapes and asserts one identical result.

If `npm run doctor` reports a failure, fix the `path`/`query` in that JSON to match the docs you were
given and re-run. **No code change is needed.** `doctor` prints the raw top-level keys of the first
record it receives, which is usually enough to correct a `fieldMap` in a minute.

Auth is configurable too — set `FRONTRUN_AUTH_HEADER` (and `FRONTRUN_AUTH_PREFIX=Bearer` if the API
uses `Authorization`). The key is only ever sent as a header, never in a URL; there is a test for that.

---

## How a call is scored

The rules were fixed before any data was looked at, and they are deliberately unflattering:

- **Entry** is the close of the first candle that ends at or after `call time + entry delay`
  (5 minutes by default). You cannot buy at the price printed the second the tweet lands, so the
  pre-call price is never used.
- **Peak** and **trough** use candle highs and lows, so "max gain" is the best a trader could have
  got, not a cherry-picked close.
- **Exit return** uses the close nearest the horizon — the peak does not count as the exit.
- A call that cannot be priced is **unscored**, never a zero. The report prints how many were dropped
  and why (`no-pool-found`, `older-than-180d-price-window`, `unsupported-chain`, …).
- **Hit** = headline-horizon return above 0%.
- **Grade**: A ≥70% hit rate, B ≥55%, C ≥45%, D ≥30%, else F. An A on a median return under 5% is
  demoted to B (a high hit rate on noise-sized moves is not skill), and any sample under 8 decided
  calls is capped at C, so three lucky calls cannot score an A. Bad grades are never capped.
- **Paper backtest** applies fee and slippage on *both* sides: a flat call is a loss, as it should be.

### Known limits

- GeckoTerminal's free tier only reaches back **180 days**, so older calls are reported as unscored
  rather than guessed at. This is stated in the output, not hidden.
- Prices come from the single deepest pool for a token. Thin or multi-pool tokens will be noisier.
- The wallet check reads **current** balances. It cannot see a sale that was followed by a re-buy.
- BNB Chain calls are priced (GeckoTerminal covers `bsc`) but the holdings check is Solana-only.

---

## Safety

This tool is **read-only research**. It:

- never connects a wallet, and has no wallet-connect code;
- never asks for a private key, seed phrase or approval — a test greps the source tree to keep it that way;
- contains **no order-placing code at all**; the only execution path is a labelled paper simulation;
- rejects any non-read Solana RPC method before it reaches the network (allow-list, with a test);
- throttles itself to stay inside documented rate limits, and never works around them;
- escapes every API-sourced string before it reaches HTML;
- keeps your key in `.env` (gitignored), sends it only as a header, and masks it in all output.

> **Risk warning.** Every number this tool produces is a backwards-looking measurement of what already
> happened. It is not a prediction, and it is **not financial advice**. Past calls do not predict
> future ones. The backtest is a simulation with assumed fills; real fills are worse.

---

## Tests

```bash
npm test          # 76 offline tests, deterministic, no network
npm run test:live # 6 tests against real GeckoTerminal + Solana RPC
```

The offline suite covers the scoring maths (entry timing, peak/trough, horizons, grading), the
cost model, the shape-tolerant API normalisation, config loading and key masking, the MCP dispatch,
and a `safety.test.js` file that encodes the hackathon's disqualification rules as assertions — no
seed-phrase or signing surface in `src/`, no key-shaped strings committed, `.env` gitignored, no
path traversal in the viewer, HTML escaped, risk warning present.

**There is no mock mode.** The client has no offline or sample fallback: if Frontrun does not answer,
the run fails loudly. The only stubs in this repo are inside `test/`, are never imported by `src/`,
and exist to test the normaliser against synthetic shapes.

---

## Provenance and disclosure

- **All code in this repository was written during the hackathon window.** Nothing was imported from
  an earlier project, so there is no pre-hackathon work to mark.
- **AI agent usage:** this project was built with heavy AI-agent assistance (Claude / Claude Code) —
  design, implementation, tests and the demo-recording script. A human set the scope, reviewed the
  output, ran the commands and recorded the demo. Disclosed because you should know.
- **Licence:** MIT (see `LICENSE`). No third-party fonts or artwork are bundled — the HTML report
  uses system font stacks only, and the video is rendered from locally installed system fonts.
- **Third-party data:** Frontrun Data API (hackathon key, not redistributed), GeckoTerminal public
  API, a public Solana JSON-RPC. No branding of any wallet, exchange or dApp is copied.

## Demo video

`demo.mp4` is produced by `node scripts/record-demo.mjs --handle <handle>` — it runs the real
commands and renders whatever they actually print, so the video cannot drift from the code. The file
is gitignored (it is too large to commit); the submission links the uploaded copy.

📹 **Demo:** _(link added on submission)_
