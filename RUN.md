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
npm test          # expect: 76 pass, 0 fail
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

A version recorded **without** a key already exists at `demo.mp4` (59.6 s: tests, live-data tests,
and the endpoint check). **Re-record it with the key and a handle before submitting** — the brief
requires the demo to show real Frontrun data flowing through the tool.

Then upload `demo.mp4` to YouTube (unlisted is fine) / Loom / X and keep the link.

---

## 4. Push the repo

`gh` is not authenticated in the agent's environment. Run this yourself:

```bash
cd D:\warung-ops\hacka\called-it
gh auth login                 # only if not already logged in
gh repo create warung-ops/called-it --public --source=. --push
```

If the `warung-ops` org does not exist, use your own account:

```bash
gh repo create called-it --public --source=. --push
```

Sanity check before pushing:

```bash
git status --short            # expect clean; .env, out/, demo/, demo.mp4 are gitignored
git log --oneline
```

Confirm on GitHub that **`.env` is not there** and `demo.mp4` is **not** committed.

Add the demo link to the README line at the bottom, then:

```bash
git commit -am "docs: add demo video link" && git push
```

---

## 5. Submit

Go to **https://hackalaunch.com/h/called-it/submit** (sign in with X as `@issue0x`) and fill in:

| Field | Value |
|---|---|
| GitHub repo | `https://github.com/warung-ops/called-it` |
| Video link | the upload from step 3 |
| Description | paste from `SUBMISSION.md` |
| Payout address | `7W31iaCmjerN1jkpEnmZevn74SZxv83yEQvLsnc4PS7Q` |

One submission per X account; you can delete and resubmit while the window is open.

The dashboard has a one-click button for this: **"$154 — submit Called It to HackaLaunch"**, which
opens the submit page and copies the description to your clipboard.

---

## 6. After submitting

Voting is token-weighted over 24 h. `$CALLEDIT` holders decide. Post the submission from `@issue0x`
with the demo video attached — voters cannot vote for what they have not seen.
