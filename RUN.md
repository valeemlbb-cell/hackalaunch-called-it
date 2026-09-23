# RUN.md — owner checklist

Everything below needs a human. The agent that built this repo cannot create accounts, request API
keys, push to GitHub or submit on the platform.

**Deadline: Sep 25, 12:20 AM UTC.** Voting opens the moment submissions close and runs 24 h.

---

## 1. Get the Frontrun hackathon API key  ← blocking, do this first

The hackathon page says: *"Participants get hackathon API access. The Frontrun Data API normally
requires a Gold Plan, and details on how to request keys are shared when the hackathon opens."*

The public Frontrun docs do **not** publish the API reference. Ask the organiser:

- HackaLaunch organiser: **@TimOnSol_** on X, or the hackathon page comments
- Frontrun API contact listed in their docs: **https://t.me/frontrunintern**

Ask for two things:

1. the hackathon API key, and
2. the API reference — **base URL, auth header name, endpoint paths and response shapes**.

Then:

```bash
cd D:\warung-ops\hacka\called-it
copy .env.example .env
# paste the key into FRONTRUN_API_KEY=
# if they say the auth header is Authorization, also set FRONTRUN_AUTH_PREFIX=Bearer
npm run doctor
```

`doctor` probes all seven endpoints and prints which answered. If some fail, open
`config/frontrun.endpoints.json` and correct the `path` / `query` for those endpoints to match the
docs, then re-run. **No code change is needed** — every path and field name lives in that one file.

---

## 2. Verify

```bash
npm test          # expect: 106 pass, 0 fail
npm run test:live # expect: 6 pass  (real GeckoTerminal + Solana RPC)
node src/cli.js report <some_kol_handle> --max-calls 25
```

Pick a handle with a real call history — `trending` gives you candidates:

```bash
node src/cli.js trending --limit 25
```

---

## 3. Record the demo video (≤ 3 minutes)

```bash
node scripts/record-demo.mjs --handle <the_handle_you_picked>
```

This runs the real commands, narrates with edge-tts, screenshots the HTML report with headless Edge,
and writes `demo.mp4` in the repo root. It prints the duration and warns if it exceeds 180 s.

A version recorded **without** a key already exists at `demo.mp4` (**95.2 s**: tests, live-data
tests, and the endpoint check — no Frontrun data in it).

> **Do not submit the current `demo.mp4`.** The brief requires the video to show real Frontrun data
> flowing through the tool, and judges DQ "non-functional demos". Re-record the moment the key
> arrives, showing `caHistory` → scored calls → `linkedWallets` on-chain check → paper backtest.

The video now renders with the DejaVu fonts committed at `assets/fonts/` (licence in the same
folder). No Windows system font is burned in any more — that was a DQ trigger under "unlicensed
artwork, fonts, or code" and it is fixed in `scripts/record-demo.mjs`.

Then upload `demo.mp4` to YouTube (unlisted is fine) / Loom / X and keep the link.

---

## 4. Push the repo

**The repo already exists and is public:**
<https://github.com/valeemlbb-cell/hackalaunch-called-it>
(created and pushed from your machine at 02:58 WIB / 19:58 UTC on Sep 23.)

The commits made after that push are still local. Send them up:

```bash
cd D:\warung-ops\hacka\called-it
git status --short            # expect clean; .env, out/, demo/, demo.mp4 are gitignored
git log --oneline
git push origin main
```

If you prefer a fresh public repo under the team org instead of the personal account, this is the
exact line (the agent cannot run it — `gh` is unauthenticated here):

```bash
gh auth login                 # only if not already logged in
gh repo create warung-ops/called-it --public --source=. --remote=org --push
```

Then use that URL in the submission form and in `SUBMISSION.md` instead of the personal one.

Then open the repo on GitHub and confirm with your own eyes that **`.env` is absent** and `demo.mp4`
is **not** committed, and that `assets/fonts/` and `examples/receipts/` *are* there.
(Checked at the time of writing: the pushed tree contains no `.env` and no key-shaped strings.)

Add the demo link to the README line at the bottom, then:

```bash
git commit -am "docs: add demo video link" && git push
```

## 5. Submit

Go to **https://hackalaunch.com/h/called-it/submit** (sign in with X as `@issue0x`) and fill in:

| Field | Value |
|---|---|
| GitHub repo | `https://github.com/valeemlbb-cell/hackalaunch-called-it` |
| Video link | the upload from step 3 |
| Description | paste from `SUBMISSION.md` |
| Payout address | `7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q` |

One submission per X account; you can delete and resubmit while the window is open.

The dashboard has a one-click button for this: **"~$193.51 + 1.6964 SOL — submit Called It to
HackaLaunch"**, which opens the submit page and copies the description to your clipboard. (The pool
is live and still moving; the rules page is the authority, the button label is only a reminder.)

---

## 6. After submitting

Voting is token-weighted over 24 h. `$CALLEDIT` holders decide. Post the submission from `@issue0x`
with the demo video attached — voters cannot vote for what they have not seen.
