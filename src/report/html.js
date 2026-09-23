/**
 * Standalone HTML report card. One self-contained file, no external assets,
 * no web fonts (system stack only, so there is nothing to licence), works
 * offline once written.
 */

const GRADE_TONE = { A: 'good', B: 'good', C: 'mid', D: 'bad', F: 'bad', 'N/A': 'mid' };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

/** A rate, not a change - no plus sign. */
function rate(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function tone(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'mid';
  return value > 0 ? 'good' : value < 0 ? 'bad' : 'mid';
}

function when(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

function short(address, size = 4) {
  const value = String(address ?? '');
  return value.length > size * 2 + 3 ? `${value.slice(0, size)}…${value.slice(-size)}` : value;
}

/**
 * Tiny inline sparkline for the paper equity curve.
 * @param {number[]} series
 */
export function sparkline(series, width = 560, height = 90) {
  const clean = series.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return '';
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const points = clean
    .map((value, index) => {
      const x = (index / (clean.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = clean[clean.length - 1];
  const stroke = last >= clean[0] ? 'var(--good)' : 'var(--bad)';
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="paper equity curve" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/**
 * @param {any} card
 * @param {any} [backtest]
 */
export function renderHtml(card, backtest = null) {
  const key = `h${card.headlineHorizonHours}`;
  const scored = card.calls.filter((entry) => entry.score?.scored);
  const gradeTone = GRADE_TONE[card.grade] ?? 'mid';

  const callRows = scored
    .map((entry) => {
      const leg = entry.score.horizons?.[key] ?? {};
      const hold =
        entry.walletCheck?.holdsNow === true
          ? '<span class="pill good">holds</span>'
          : entry.walletCheck?.holdsNow === false
            ? '<span class="pill bad">none</span>'
            : '<span class="pill">—</span>';
      const token = entry.call.symbol
        ? escapeHtml(entry.call.symbol)
        : `<code>${escapeHtml(short(entry.call.contract, 5))}</code>`;
      const link = entry.call.tweetUrl
        ? `<a href="${escapeHtml(entry.call.tweetUrl)}" rel="noreferrer noopener nofollow" target="_blank">tweet</a>`
        : '—';
      return `<tr>
        <td class="mono dim">${escapeHtml(when(entry.call.calledAt))}</td>
        <td>${token}</td>
        <td class="num ${tone(leg.returnPct)}">${pct(leg.returnPct)}</td>
        <td class="num dim">${pct(leg.maxGainPct)}</td>
        <td class="num dim">${pct(leg.maxDrawdownPct)}</td>
        <td>${hold}</td>
        <td class="dim">${link}</td>
      </tr>`;
    })
    .join('\n');

  const walletRows = (card.linkedWallets ?? [])
    .map((wallet) => {
      const labels = (wallet.labels ?? []).map((label) => label.label).filter(Boolean);
      const chips = labels.length
        ? labels.map((label) => `<span class="pill">${escapeHtml(label)}</span>`).join(' ')
        : '<span class="dim">no labels returned</span>';
      return `<li><code>${escapeHtml(wallet.address)}</code> <span class="dim">&middot; ${escapeHtml(wallet.chain ?? '')} &middot;</span> ${chips}</li>`;
    })
    .join('\n');

  const flagRows = (card.talkVsTradeFlags ?? [])
    .slice(0, 12)
    .map(
      (flag) =>
        `<li><strong>${escapeHtml(flag.symbol ?? short(flag.contract, 6))}</strong> called ${escapeHtml(when(flag.calledAt))} · ${pct(flag.returnPct)} · linked wallets hold none today</li>`,
    )
    .join('\n');

  const receipts = (card.sources?.frontrunCalls ?? [])
    .map(
      (call) =>
        `<li><code>${escapeHtml(call.endpoint)}</code> <span class="dim">HTTP ${call.status} · ${call.count} items · ${call.durationMs}ms</span></li>`,
    )
    .join('\n');

  const backtestBlock = backtest
    ? `<section class="panel">
      <h2>Paper backtest <span class="tag">simulation only</span></h2>
      <div class="stats">
        ${stat('P&L', pct(backtest.returnPct), tone(backtest.returnPct))}
        ${stat('Win rate', rate(backtest.winRatePct), 'mid')}
        ${stat('Trades', String(backtest.tradeCount), 'mid')}
        ${stat('Max drawdown', pct(backtest.maxDrawdownPct), 'bad')}
      </div>
      ${sparkline(backtest.equityCurve.map((point) => point.equity))}
      <p class="dim small">$${backtest.settings.positionUsd} per call, ${backtest.settings.feeBps}bps fee and
      ${backtest.settings.slippageBps}bps slippage <em>per side</em>, entry ${card.entryDelayMinutes ?? 5} min after the
      tweet, exit at ${backtest.settings.exitHorizonHours}h. No order was placed. Not financial advice.</p>
    </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Called It — @${escapeHtml(card.handle)} report card</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f6f5f1;
  --surface: #ffffff;
  --ink: #16161a;
  --dim: #6c6a73;
  --line: #e2e0da;
  --good: #1f8a4c;
  --bad: #c0392b;
  --accent: #3a2fd6;
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#111014; --surface:#1a191f; --ink:#f2f1ee; --dim:#9b98a3; --line:#2b2a32; --good:#46c07c; --bad:#ef6b5a; --accent:#8d86ff; }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 72px; }
header { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-end; justify-content: space-between; margin-bottom: 28px; }
.brand { font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: var(--dim); }
h1 { font-size: clamp(30px, 6vw, 46px); margin: 6px 0 2px; letter-spacing: -.02em; }
h2 { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); margin: 0 0 14px; }
.grade { font-size: clamp(56px, 14vw, 104px); line-height: .9; font-weight: 700; letter-spacing: -.02em; padding-right: 4px; flex: 0 0 auto; }
.grade.good { color: var(--good); } .grade.bad { color: var(--bad); } .grade.mid { color: var(--accent); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; margin-bottom: 18px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 14px; }
.stat { border-left: 3px solid var(--line); padding-left: 12px; }
.stat .label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.stat .value { font-size: 26px; font-weight: 650; letter-spacing: -.02em; }
.stat.good .value { color: var(--good); } .stat.bad .value { color: var(--bad); }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); padding: 0 10px 8px 0; border-bottom: 1px solid var(--line); }
td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr:hover td { background: color-mix(in oklab, var(--accent) 7%, transparent); }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.good { color: var(--good); } .bad { color: var(--bad); } .dim { color: var(--dim); }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.pill { display: inline-block; font-size: 11px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--dim); }
.pill.good { color: var(--good); border-color: color-mix(in oklab, var(--good) 45%, var(--line)); }
.pill.bad { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, var(--line)); }
.tag { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; border: 1px solid var(--line); border-radius: 999px; padding: 2px 9px; color: var(--accent); margin-left: 8px; }
ul { margin: 0; padding-left: 18px; }
li { margin-bottom: 6px; }
.spark { width: 100%; height: 90px; margin: 14px 0 4px; display: block; }
.small { font-size: 13px; }
.warn { border-left: 3px solid var(--bad); padding: 10px 14px; background: color-mix(in oklab, var(--bad) 8%, transparent); border-radius: 0 var(--radius) var(--radius) 0; }
footer { color: var(--dim); font-size: 12.5px; margin-top: 26px; }
a { color: var(--accent); }
.scroll { overflow-x: auto; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <div class="brand">Called It · Frontrun Data API</div>
      <h1>@${escapeHtml(card.handle)}</h1>
      <div class="dim small">${escapeHtml(card.totals.scored)} of ${escapeHtml(card.totals.calls)} calls priced ·
      ${escapeHtml(card.headlineHorizonHours)}h horizon · ${escapeHtml(card.confidence)} confidence ·
      generated ${escapeHtml(card.generatedAt)}</div>
    </div>
    <div class="grade ${gradeTone}">${escapeHtml(card.grade)}</div>
  </header>

  <section class="panel">
    <div class="stats">
      ${stat('Hit rate', rate(card.hitRatePct), 'mid')}
      ${stat(`Median ${card.headlineHorizonHours}h`, pct(card.medianReturnPct), tone(card.medianReturnPct))}
      ${stat('Median peak', pct(card.medianMaxGainPct), 'good')}
      ${stat('Median trough', pct(card.medianMaxDrawdownPct), 'bad')}
    </div>
  </section>

  ${backtestBlock}

  <section class="panel">
    <h2>Every call, scored</h2>
    <div class="scroll">
    <table>
      <thead><tr>
        <th>Called (UTC)</th><th>Token</th><th class="num">${escapeHtml(card.headlineHorizonHours)}h</th>
        <th class="num">Peak</th><th class="num">Trough</th><th>Linked wallet</th><th>Source</th>
      </tr></thead>
      <tbody>${callRows || '<tr><td colspan="7" class="dim">No calls could be priced.</td></tr>'}</tbody>
    </table>
    </div>
  </section>

  ${
    flagRows
      ? `<section class="panel"><h2>Talk vs trade</h2><ul>${flagRows}</ul>
         <p class="dim small">Called the token, and the wallets Frontrun links to this account hold none of it today.
         A current balance is not proof of a sale — it is a place to look.</p></section>`
      : ''
  }

  <section class="panel">
    <h2>Linked wallets (Frontrun)</h2>
    <ul>${walletRows || '<li class="dim">No linked wallets returned for this handle.</li>'}</ul>
  </section>

  <section class="panel">
    <h2>Receipts</h2>
    <ul>${receipts || '<li class="dim">No API calls logged.</li>'}</ul>
    <p class="dim small">Call source: ${escapeHtml(card.sources?.callSource ?? '—')}<br>
    Price data: ${escapeHtml(card.sources?.priceData ?? '—')}<br>
    On-chain: ${escapeHtml(card.sources?.onchain ?? '—')}</p>
  </section>

  <section class="panel warn">
    <strong>Risk warning.</strong> Called It is a research and simulation tool. It is read-only: it never connects a
    wallet, never asks for a key or seed phrase, never requests an approval and contains no order-placing code.
    Every number here is a backwards-looking measurement. Nothing on this page is financial advice.
  </section>

  <footer>MIT licensed · built for the Called It hackathon on HackaLaunch · social signal from the Frontrun Data API,
  prices from GeckoTerminal, balances from a public Solana RPC.</footer>
</div>
</body>
</html>`;
}

function stat(label, value, toneName = 'mid') {
  return `<div class="stat ${toneName}"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}
