# REVIEW_2 — Judge 2: deliverables-checklist audit (called-it)

Date: 2026-09-24 03:4x WIB. Auditor scope: does this packet satisfy every artefact the
hackalaunch.com/h/called-it rules page requires, and does it actually do what it says?

## Rules re-read (hackalaunch.com/h/called-it)

Required: public GitHub repo with README explaining execution + endpoint usage; demo video
<= 3 min on YouTube/Loom/Vimeo/X **showing real Frontrun data flowing through the tool**;
brief description; live link or install instructions; >=1 social endpoint; >=1 wallet endpoint
verified against live Solana/BNB data; receipts (backtest / hit rate / timeline); no keys in
repo; paper-trading default + risk warning; pre-hackathon work marked.
DQ triggers include: non-functional demos, **projects not genuinely calling Frontrun endpoints
(faked/hardcoded/mocked)**, key sharing, rate-limit circumvention, unlicensed artwork/fonts/code.
Deadline Sep 25 00:20 UTC. Pool $193.51 + 90% of future fees. 24h token-weighted vote.

## Checklist

| # | Required artefact | Status | Evidence |
|---|---|---|---|
| 1 | Public GitHub repo | PARTIAL | `github.com/valeemlbb-cell/hackalaunch-called-it` pushed 02:58 WIB. But 2 commits are local-only and 2 files are **uncommitted** (`scripts/record-demo.mjs`, `src/report/html.js`) — the public tree is NOT the audited tree |
| 2 | README explains execution | PASS | install, flags, CLI, MCP config, endpoint map all present |
| 3 | README explains endpoint usage | PASS (strong) | per-endpoint table, social vs wallet, `npm run doctor` probe |
| 4 | >=1 social endpoint | CODED, UNVERIFIED | `caHistory`, `trendingAccounts`, `smartFollowers` wired; never executed — no key |
| 5 | >=1 wallet endpoint vs live Solana/BNB | CODED, UNVERIFIED | `linkedWallets`/`walletLabels`/`pnlLeaderboard`; Solana read path is verified live (6/6 live tests pass) but the Frontrun half is not |
| 6 | Receipts (backtest/hit rate) | PASS | `reportCard`, `paperBacktest`, HTML+JSON output, `out/sample-list.*` exist |
| 7 | **Demo video <= 3 min showing real Frontrun data** | **FAIL** | `demo.mp4` is 90.1 s (fine on length) but was recorded **without a key**: it shows tests + GeckoTerminal/Solana only. RUN.md admits this. This is the one hard requirement not met |
| 8 | Video uploaded + link | FAIL | README has `_(link added on submission)_`; SUBMISSION.md has no video URL |
| 9 | Brief description | PASS | SUBMISSION.md, paste-ready |
| 10 | Install instructions | PASS | README + RUN.md |
| 11 | No keys/secrets in repo | PASS | `.env`, `.env.*` (except `.env.example`) gitignored; `.env.example` holds no values; `safety.test.js` asserts it |
| 12 | Paper-trading default + risk warning | PASS | no order-placing code at all; explicit risk warning in README and rendered report |
| 13 | Pre-hackathon work marked | PASS | README states all code written in-window, nothing imported |
| 14 | MIT licence | PASS | `LICENSE` present, MIT, matches package.json |
| 15 | Licensed assets only | **FAIL (DQ risk)** | `scripts/record-demo.mjs` L149-150 copies `C:/Windows/Fonts/consola.ttf` and `seguisb.ttf` and burns them into the distributed video. Consolas / Segoe UI Semibold are proprietary Microsoft fonts; redistribution in rendered video is not covered by the Windows licence. README's "rendered from locally installed system fonts" does not establish a licence |
| 16 | Tests actually run and pass | PASS | `npm test` → **104 pass / 0 fail** (405 ms). `npm run test:live` → **6 pass / 0 fail** (76.6 s, real GeckoTerminal + Solana RPC). Verified by this auditor, not taken on trust |
| 17 | No mock/hardcoded Frontrun responses | PASS | no offline fallback in `src/frontrun/client.js`; stubs live only in `test/` |

## Blocking findings

**B1 — Demo does not show real Frontrun data (rule-page requirement + DQ trigger).**
The single explicit video requirement is unmet. Without the hackathon key this cannot be fixed
by an agent. Everything else in the packet is downstream of this.

**B2 — The entire Frontrun integration is unexecuted.** `config/frontrun.endpoints.json`
paths/params are inferred, not confirmed against the (Gold-gated) reference. `FRONTRUN_BASE_URL`
defaults to a guessed `https://api.frontrun.pro`. If the real base URL or auth header differs,
`doctor` returns 0/7 and the submission is a tool that has never called the API it is built on.
The shape-tolerant design mitigates field drift, not a wrong host/path.

**B3 — Audited tree != public tree.** Two modified files uncommitted, two commits unpushed.

**B4 — Proprietary fonts burned into the submitted video.** Direct hit on the
"unlicensed artwork, fonts, or code" DQ trigger.

## Non-blocking findings

- **Stale numbers.** README (x3), RUN.md and SUBMISSION.md all claim "76 offline tests". Actual
  is 104. RUN.md claims the existing demo is 59.6 s; it is 90.1 s. A judge who checks one number
  and finds it wrong discounts the rest.
- **Duplicate/odd history.** `git log` shows two "called-it: HackaLaunch submission" commits
  (61902e3, 2d567c5) around the feature commits — untidy for a public repo.
- **Empty tracked-adjacent dirs.** `docs/` and `test/fixtures/` are empty.
- **No "live link"** — the rules offer *live link OR install instructions*; install instructions
  satisfy it, but `npm run serve` (127.0.0.1:8788) is local-only, so do not describe it as a live link.
- **Mainnet vs internal devnet-only rule.** `SOLANA_RPC_URL` defaults to mainnet-beta. All calls
  are read-only through an enforced allow-list, so no funds are at risk, but README should state
  in one line: "read-only mainnet RPC; no transaction is ever built, signed or sent."
- **No program IDs section** — correct here (no deployed program), but README should say so
  explicitly so a judge does not read the omission as a gap.

## Concrete fixes, in order

1. Get the key (RUN.md step 1: @TimOnSol_ / t.me/frontrunintern), run `npm run doctor`, fix
   `config/frontrun.endpoints.json` until 7/7, then **re-record `demo.mp4` with a real handle**
   so Frontrun rows are visibly on screen. Upload; paste the URL into README's demo line and
   SUBMISSION.md. This alone moves the packet from non-compliant to compliant.
2. Replace the two Windows fonts in `scripts/record-demo.mjs` with OFL fonts (JetBrains Mono +
   Inter), vendor them under `assets/fonts/` with their `OFL.txt`, and add one README line naming
   the fonts and their licence.
3. `git add -A && git commit && git push origin main`; then verify on GitHub that the public tree
   has no `.env`, no `demo.mp4`, and includes the two currently-uncommitted files.
4. Global replace "76 offline tests" → "104 offline tests" in README.md, RUN.md, SUBMISSION.md;
   fix the "59.6 s" demo duration in RUN.md.
5. Add to README: one line that the on-chain reads are read-only mainnet with no signing surface,
   and one line stating there is no deployed program (hence no program IDs).
6. Capture `doctor` output (key masked) into `docs/DOCTOR_OUTPUT.md` as the receipt that the
   Frontrun endpoints really answered — the cheapest possible defence against the
   "not genuinely calling Frontrun endpoints" DQ trigger.
7. Optional: squash the duplicate submission commits before the final push.

## Score

**68 / 100.**

Engineering is above the bar for this pool: zero runtime deps, 110 tests that genuinely pass when
run, a real cost model, an enforced read-only RPC allow-list, and a safety suite that encodes the
DQ rules as assertions. It loses 32 points on deliverables, not on craft: the demo video does not
show the required real Frontrun data, the API integration has never once executed, the public repo
lags the local tree, and proprietary fonts are baked into the artefact that gets uploaded.
Fix 1 + 2 + 3 and this is a 90.
