# REVIEW_3 — judge as token holder

Reviewer: judge 3 (independent). Scope: repo as it stands 2026-09-24 03:3x WIB.
Rules re-read from https://hackalaunch.com/h/called-it.

## Verdict

**Score: 74 / 100.** Would I vote for it over a typical submission? Yes on substance,
maybe not on presentation — and this vote is decided by token holders skimming, not by
people who will run `npm test`.

## What checks out

- Rules coverage is complete and then some: 3 social + 3 wallet endpoints required at
  minimum one each; this uses all seven, and `npm run doctor` is a smart way to prove it.
- "Receipts" requirement is met by design: real GeckoTerminal candles, entry-delay + fee +
  slippage on both sides, unscored-not-zero, grade caps on small samples. The scoring rules
  are deliberately unflattering, which reads as honest rather than marketing.
- Disqualification surface is clean: no mock mode (explicit), `.env` gitignored, no key-shaped
  strings in the tree, no order-placing code, RPC method allow-list, risk warning, MIT, no
  bundled fonts/art in the tracked tree (`demo/*.ttf` is gitignored).
- Tests actually run: `npm test` → **104 pass / 0 fail** locally.

## Where it loses votes

1. **The demo video does not show real API data.** The rules say the video must show *real API
   data with receipts*. RUN.md admits the current 59.6 s `demo.mp4` was recorded with no key and
   shows only tests + endpoint probing. Submitted as-is this is a rule miss, not a polish gap —
   a rival judge could argue disqualification-adjacent, and voters will see a video with no
   report card in it.
2. **Nothing has ever touched the live Frontrun API.** All seven endpoints are config-driven
   guesses against a Gold-gated reference. The flexible `fieldMap` design is the right hedge,
   but if `doctor` fails at 11 pm on the 24th there is no output at all — the project has a
   single point of failure it has not yet cleared.
3. **The GitHub page is text-only.** `out/` is gitignored, so a voter opening the repo sees no
   screenshot of the HTML report card — only an ASCII block that reads as mock-up. For a
   token-weighted vote, the repo page *is* the pitch.
4. **Stated numbers contradict the code.** README and SUBMISSION both say "76 offline tests";
   the suite reports 104. Small, but a judge who runs it notices, and it undercuts the
   "everything here is verifiable" posture that is this project's whole angle.
5. **README opens with the ASCII table showing invented figures** (@someone, WIF +62.1%). Next
   to a "no mock mode" claim, fabricated sample numbers are the one thing an opponent can
   screenshot out of context. Label it or replace it with a real run.
6. Identity is split: repo lives under `valeemlbb-cell`, team is Warung Ops / `@issue0x`. Minor,
   but voters check whether the poster owns the repo.

## Fixes, in order of vote impact

1. **Get the key and re-record the demo with a real handle** (RUN.md step 1 → step 3). This is
   the single change that most raises its odds; everything else is cosmetic next to it.
   If the key does not arrive in time, re-record showing `doctor` + a live GeckoTerminal-scored
   run and say plainly in the description that Frontrun access was not granted — voters forgive
   a blocked key, they do not forgive a video that looks empty.
2. **Commit a real report-card screenshot** (`docs/report-card.png`) and put it at the top of the
   README, above the fold, plus the demo link. Un-ignore one `out/<handle>.html` as `examples/`.
3. Replace the ASCII sample with output from a real run, or mark it `# illustrative layout`.
4. Fix the test count to 104 in README + SUBMISSION (and keep them in sync).
5. Tighten the SUBMISSION description: first two lines currently spend words on follower counts.
   Lead with "we scored N real calls from M accounts, here is the hit rate" — voters read one
   screen.
6. Push under the team org or rename the repo owner line so repo, X account and payout address
   read as one team.

## Scoring breakdown

| Axis | Weight | Score |
|---|---|---|
| Rules compliance | 25 | 19 (video deliverable unmet as of now) |
| Usefulness / originality (talk-vs-trade check) | 25 | 22 |
| Proof it works on real data | 20 | 11 |
| Presentation to a non-technical voter | 20 | 13 |
| Safety / disqualification hygiene | 10 | 9 |
| **Total** | **100** | **74** |
