# REVIEW_1 — hostile-judge audit of `called-it`

Reviewer: Judge 1 (adversarial). Date: 2026-09-24 03:0x WIB.
Rules re-read from https://hackalaunch.com/h/called-it (fetched this run).

## Rules that matter (verbatim gist)
- 3 required components: social endpoint + wallet endpoint checked against **live Solana/BNB** data + receipts (backtest/hit-rate/real examples).
- Public repo + README, demo video ≤3 min **showing real data and receipts**, description, install steps.
- No credentials in repo; `.env.example` required.
- DQ: plagiarism, **non-functional demos**, malicious code, **fake/hardcoded API responses or not genuinely calling endpoints**, unauthorized live trading / seed-phrase requests, API-key sharing, branding mimicry, **unlicensed artwork, fonts or code**.

## Verified good
- `.env.example` present, zero values; `.gitignore` excludes `.env`, `out/`, `demo/`, `demo.mp4`.
- Secret scan clean: no key-shaped strings, no `Keypair.from`/`signTransaction`/`sendTransaction` anywhere in `src/`.
- `test/safety.test.js` encodes the DQ rules as assertions (read-only RPC allowlist, path-traversal refusal, HTML escaping, risk warning always rendered).
- `npm test` → **104 pass / 0 fail** this run. No runtime deps. MIT `LICENSE`.
- No order-placing code, no wallet connect, no admin backdoor, no outreach/posting feature (so no human-approval gate is owed — nothing auto-sends).
- AI-agent usage and "no pre-hackathon work" disclosed in README §219-222.
- demo.mp4 = 90.1 s, inside the 3-minute cap.

## DISQUALIFIER RISKS (ranked)

**1. CRITICAL — the shipped demo shows no real Frontrun data.**
`demo.mp4` was recorded without an API key; it shows tests and an endpoint probe. Rules demand a video "showing real data and receipts", and DQ lists "non-functional demos" and "projects not genuinely calling endpoints". A hostile judge watching this video today disqualifies it. RUN.md §3 admits this and defers to a re-record — but the re-record is blocked on a key the team does not yet hold, so this is the single point of failure for the whole packet.

**2. HIGH — unlicensed fonts in the video.**
`scripts/record-demo.mjs:149-150` copies `C:/Windows/Fonts/consola.ttf` and `seguisb.ttf` and burns them into the video via ffmpeg `drawtext`. Consolas and Segoe UI Semibold are proprietary Microsoft fonts; embedding their glyphs in a published video is redistribution. Rules DQ "unlicensed ... fonts" explicitly. README §223-224 makes it worse by stating in writing that the video "is rendered from locally installed system fonts" — that sentence hands the judge the evidence.

**3. MEDIUM — receipts are only reachable with a key; there is no reproducible artifact.**
`out/sample-list.*` is a call *list*, not a scored report card. "No mock mode" is defensible against the fake-response DQ, but it means a judge with no key sees nothing work. Rules require "receipts ... backtest, hit rate, or real examples".

**4. MEDIUM — stale numbers undercut credibility.**
`RUN.md` and `SUBMISSION.md` claim "76 pass"; actual is 104. Dashboard button says "$154"; the rules page now shows ~$193.51 + 1.6964 SOL. Inaccurate self-reporting invites the judge to doubt the rest.

**5. LOW/MEDIUM — internal "devnet only" rule vs mainnet RPC.**
`src/lib/env.js:67` defaults `SOLANA_RPC_URL` to mainnet-beta. The hackathon *requires* live Solana data, and every call is read-only (enforced by a test), so this is correct for the contest — but it is not devnet, and nothing in README states plainly "read-only mainnet reads, no funds, no signing, no devnet needed". Say it out loud before a judge or a teammate calls it a rule break.

**6. LOW — repo hygiene at submission time.**
Working tree is dirty (`scripts/record-demo.mjs`, `src/report/html.js` modified) while RUN.md §4 tells the owner to "expect clean". Repo lives at a personal remote `valeemlbb-cell/hackalaunch-called-it`, not under the team org — fine for rules, inconsistent with the branding in SUBMISSION.md.

No plagiarism signal found: code is idiosyncratic, zero-dependency, and internally consistent.

## Concrete fixes (in order)
1. The moment the key lands, run `node scripts/record-demo.mjs --handle <handle>` and re-record with a real handle so the video shows `caHistory` → scored calls → `linkedWallets` on-chain check → backtest. Do not submit the current file.
2. Replace the two Windows fonts with OFL fonts (JetBrains Mono + Inter), commit them under `assets/fonts/` with their `OFL.txt`, point `record-demo.mjs:149-150` at those files, and rewrite README §223-224 to name the fonts and their licence.
3. Ship a reproducible receipt: commit a redacted real report card (`out/report-card.sample.html` + `.json`) from the keyed run, and link it from README and SUBMISSION so a keyless judge can still see output. Label it "captured from a live run on <date>", never as a fixture the code reads.
4. Fix the counts: "104 pass" in RUN.md §2 and SUBMISSION.md; update the dashboard button label to the current pool.
5. Add one README line: "All on-chain access is read-only mainnet JSON-RPC (`getAccountInfo`/`getTokenAccountsByOwner`); the tool holds no keys, signs nothing, and moves no funds."
6. Commit or revert the two dirty files, then `git push origin main`, and confirm on GitHub that `.env` and `demo.mp4` are absent.

## Score: 72/100
Engineering, safety posture and rules-alignment are genuinely strong (that would be 88). Minus 16 for a demo that, as it stands today, meets the platform's own definition of a non-functional demo, plus a written admission of proprietary fonts in the video. Both are fixable in under an hour once the key arrives.
