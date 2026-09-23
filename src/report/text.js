/**
 * Terminal rendering. Plain ASCII so it survives Windows consoles and
 * screen-capture re-encoding.
 */

/** @param {number|null|undefined} value @param {number} [digits] */
export function pct(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '  n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** @param {number|null|undefined} value */
export function usd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `$${value.toFixed(2)}`;
}

/** @param {number|null|undefined} seconds */
export function when(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 16);
}

/** @param {string} title */
export function rule(title = '') {
  const width = 78;
  if (!title) return '-'.repeat(width);
  const label = ` ${title} `;
  return `-- ${label}${'-'.repeat(Math.max(0, width - label.length - 3))}`;
}

/**
 * @param {string[][]} rows first row is the header
 */
export function table(rows) {
  if (rows.length === 0) return '';
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => String(row[index] ?? '').length)));
  return rows
    .map((row, rowIndex) => {
      const line = row.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ');
      return rowIndex === 0 ? `${line}\n${widths.map((width) => '-'.repeat(width)).join('  ')}` : line;
    })
    .join('\n');
}

/**
 * @param {any} card output of buildKolReport
 */
export function renderReportCard(card) {
  const key = `h${card.headlineHorizonHours}`;
  const lines = [];

  lines.push(rule(`CALLED IT - report card for @${card.handle}`));
  lines.push('');
  lines.push(
    `grade ${card.grade}   hit rate ${pct(card.hitRatePct)}   median ${card.headlineHorizonHours}h ${pct(card.medianReturnPct)}   median peak ${pct(card.medianMaxGainPct)}`,
  );
  lines.push(
    `calls ${card.totals.calls}  scored ${card.totals.scored}  unscored ${card.totals.unscored}  confidence ${card.confidence}`,
  );
  if (card.totals.unscored > 0) {
    lines.push(`unscored reasons: ${JSON.stringify(card.unscoredReasons)}`);
  }
  lines.push('');

  if (card.linkedWallets?.length) {
    lines.push(rule('linked wallets (Frontrun)'));
    for (const wallet of card.linkedWallets) {
      const labels = (wallet.labels ?? []).map((label) => label.label).filter(Boolean).join(', ') || 'no labels';
      lines.push(`  ${wallet.address}  [${wallet.chain}]  ${labels}`);
    }
    lines.push('');
  }

  const scored = card.calls.filter((entry) => entry.score?.scored);
  if (scored.length > 0) {
    lines.push(rule('scored calls'));
    lines.push(
      table([
        ['when (UTC)', 'token', `${card.headlineHorizonHours}h`, 'peak', 'trough', 'hold?'],
        ...scored.slice(0, 25).map((entry) => {
          const leg = entry.score.horizons?.[key] ?? {};
          const hold =
            entry.walletCheck?.holdsNow === true ? 'yes' : entry.walletCheck?.holdsNow === false ? 'NO' : '-';
          return [
            when(entry.call.calledAt),
            entry.call.symbol ?? `${entry.call.contract.slice(0, 6)}..`,
            pct(leg.returnPct),
            pct(leg.maxGainPct),
            pct(leg.maxDrawdownPct),
            hold,
          ];
        }),
      ]),
    );
    lines.push('');
  }

  if (card.talkVsTradeFlags?.length) {
    lines.push(rule('talk vs trade - called it, linked wallets hold none now'));
    for (const flag of card.talkVsTradeFlags.slice(0, 10)) {
      lines.push(`  ${flag.symbol ?? flag.contract.slice(0, 10)}  called ${when(flag.calledAt)}  ${pct(flag.returnPct)}`);
    }
    lines.push('');
  }

  lines.push(rule('receipts'));
  lines.push(`  call source: ${card.sources.callSource ?? 'unknown'}`);
  // Only the Frontrun path has an API call log; a local call list has none.
  const frontrunCalls = card.sources.frontrunCalls ?? [];
  if (frontrunCalls.length > 0) {
    lines.push(`  Frontrun API calls this run: ${frontrunCalls.length}`);
    for (const call of frontrunCalls) {
      lines.push(`    ${String(call.status).padEnd(4)} ${call.count.toString().padStart(4)} items  ${call.endpoint}`);
    }
  }
  lines.push(`  price data: ${card.sources.priceData}`);
  lines.push(`  on-chain:   ${card.sources.onchain}`);
  lines.push('');
  return lines.join('\n');
}

/** @param {ReturnType<import('../score/paperBacktest.js').runPaperBacktest>} result */
export function renderBacktest(result) {
  const lines = [];
  lines.push(rule('PAPER BACKTEST - simulation only, no orders are ever placed'));
  lines.push('');
  lines.push(
    `bankroll ${usd(result.startingBankrollUsd)} -> ${usd(result.endingBankrollUsd)}   ` +
      `pnl ${usd(result.realisedPnlUsd)} (${pct(result.returnPct)})`,
  );
  lines.push(
    `trades ${result.tradeCount}  win rate ${pct(result.winRatePct)}  max drawdown ${pct(result.maxDrawdownPct)}  unpriced skipped ${result.unpricedCount}`,
  );
  lines.push(
    `costs: ${result.settings.feeBps}bps fee + ${result.settings.slippageBps}bps slippage per side, exit at ${result.settings.exitHorizonHours}h`,
  );
  lines.push('');
  if (result.trades.length > 0) {
    lines.push(
      table([
        ['when (UTC)', 'token', 'gross', 'net', 'pnl'],
        ...result.trades.slice(0, 25).map((trade) => [
          when(trade.calledAt),
          trade.symbol ?? `${trade.contract.slice(0, 6)}..`,
          pct(trade.grossReturnPct),
          pct(trade.netReturnPct),
          usd(trade.pnlUsd),
        ]),
      ]),
    );
    lines.push('');
  }
  lines.push('NOT FINANCIAL ADVICE. Past calls do not predict future ones.');
  lines.push('');
  return lines.join('\n');
}
