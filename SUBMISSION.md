# Submission text

Paste the block below into the "description" field at https://hackalaunch.com/h/called-it/submit

---

**Called It — KOL report cards, scored against what actually happened.**

Follower counts tell you who is loud, not who is right. Called It takes any X handle, pulls every
contract address that handle has posted from the Frontrun Data API `caHistory` endpoint, and scores
each call against real hourly candles: return at 1h / 6h / 24h, the peak a trader could actually have
caught, and the trough they had to sit through. Then it asks the question the timeline never answers
— it takes the wallets Frontrun links to that account (`linkedWallets` + `walletLabels`) and checks
on-chain, read-only, whether those wallets still hold what their owner told you to buy. Calls that
went up while the caller holds none of it today get flagged as talk-vs-trade.

Out comes a graded report card — hit rate, median return, per-call detail, linked wallets and their
labels — as a terminal table, a self-contained shareable HTML page, and JSON. A paper backtest shows
what copying those calls would really have returned after a 5-minute entry delay, 30 bps of fees and
100 bps of slippage **on each side**. It is simulation only: this repo contains no order-placing code
at all, no wallet connect, and nothing that can touch a key.

All seven Frontrun endpoints are wired up (`caHistory`, `linkedWallets`, `walletLabels`,
`trendingAccounts`, `smartFollowers`, `mentionedWallets`, `pnlLeaderboard`) and `npm run doctor`
probes each one with your key and prints exactly what answered. Because the API reference is
Gold-gated, **no endpoint path or response field name is hard-coded** — they all live in
`config/frontrun.endpoints.json`, and the client normalises whatever shape comes back, so matching
the real docs is a one-file edit, not a rewrite.

Also ships an MCP server (`npm run mcp`) so Claude or any MCP client can ask for a report card in
plain language — three read-only tools, none of which can trade or reveal the key.

Zero runtime dependencies. 106 offline tests plus 6 live-network tests, including a `safety.test.js`
that encodes this hackathon's disqualification rules as assertions: no seed-phrase or signing surface
anywhere in `src/`, no key-shaped strings committed, `.env` gitignored, no path traversal in the
viewer, all API-sourced strings HTML-escaped, risk warning always rendered. There is no mock mode —
if Frontrun does not answer, the run fails loudly rather than showing you data it did not receive.

You do not need a key to check it works: `examples/receipts/` holds a report card (HTML + JSON)
captured from a live run on 2026-09-24 via the keyless `score-list` path - real GeckoTerminal
candles, real read-only Solana RPC, the same scoring code a keyed run uses. It is captured output,
not a fixture; a test asserts nothing in `src/` reads it.

All on-chain access is read-only Solana mainnet JSON-RPC behind a method allow-list. The tool holds
no key of any kind, signs nothing, moves no funds, and deploys no program.

Node 20+, MIT. The only bundled assets are two DejaVu fonts for the demo video, committed at
`assets/fonts/` with their licence. All code written during the hackathon window; built with
AI-agent assistance (disclosed in the README).

Repo: https://github.com/valeemlbb-cell/hackalaunch-called-it

Run it: `cp .env.example .env` → add key → `npm run doctor` → `node src/cli.js backtest <handle>`.

Not financial advice.
