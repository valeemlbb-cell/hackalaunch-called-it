/**
 * Paper-trading backtest. Pure, unit tested, and the ONLY execution path in
 * this project - there is no live-trading code anywhere in the repo.
 *
 * Costs are modelled explicitly so the number is not a fantasy:
 *  - entryDelayMinutes: you see the tweet late
 *  - slippageBps: applied on both sides, against you
 *  - feeBps: applied on both sides
 *  - fixed position size, capped by remaining bankroll
 *
 * A call that cannot be priced is skipped, never counted as break-even.
 */

export const DEFAULT_BACKTEST = Object.freeze({
  bankrollUsd: 1000,
  positionUsd: 100,
  feeBps: 30,
  slippageBps: 100,
  exitHorizonHours: 24,
});

const BPS = 10_000;

/**
 * @param {import('./reportCard.js').ScoredCall[]} scoredCalls
 * @param {Partial<typeof DEFAULT_BACKTEST>} [options]
 */
export function runPaperBacktest(scoredCalls, options = {}) {
  const settings = { ...DEFAULT_BACKTEST, ...options };
  const key = `h${settings.exitHorizonHours}`;

  const tradable = scoredCalls
    .filter((entry) => entry.score?.scored)
    .map((entry) => ({ entry, leg: entry.score.horizons?.[key] }))
    .filter((row) => row.leg && typeof row.leg.returnPct === 'number' && Number.isFinite(row.leg.returnPct))
    .sort((a, b) => a.entry.call.calledAt - b.entry.call.calledAt);

  let cash = settings.bankrollUsd;
  let realisedPnl = 0;
  const trades = [];
  const equityCurve = [{ t: tradable[0]?.entry.call.calledAt ?? null, equity: cash }];

  for (const { entry, leg } of tradable) {
    const size = Math.min(settings.positionUsd, cash);
    if (size <= 0) {
      trades.push({ contract: entry.call.contract, skipped: 'bankroll-exhausted' });
      continue;
    }

    const grossMultiple = 1 + leg.returnPct / 100;
    // Slippage + fee on the way in and on the way out.
    const costMultiple = (1 - (settings.slippageBps + settings.feeBps) / BPS) ** 2;
    const netMultiple = grossMultiple * costMultiple;
    const pnl = size * (netMultiple - 1);

    cash += pnl;
    realisedPnl += pnl;

    trades.push({
      contract: entry.call.contract,
      symbol: entry.call.symbol ?? null,
      calledAt: entry.call.calledAt,
      entryAt: entry.score.entryAt,
      entryPrice: entry.score.entryPrice,
      exitPrice: leg.exitPrice,
      grossReturnPct: leg.returnPct,
      netReturnPct: (netMultiple - 1) * 100,
      sizeUsd: size,
      pnlUsd: pnl,
      tweetUrl: entry.call.tweetUrl ?? null,
    });
    equityCurve.push({ t: leg.exitAt ?? entry.call.calledAt, equity: cash });
  }

  const executed = trades.filter((trade) => !trade.skipped);
  const wins = executed.filter((trade) => trade.pnlUsd > 0);

  return {
    mode: 'paper',
    settings,
    startingBankrollUsd: settings.bankrollUsd,
    endingBankrollUsd: cash,
    realisedPnlUsd: realisedPnl,
    returnPct: settings.bankrollUsd > 0 ? (realisedPnl / settings.bankrollUsd) * 100 : null,
    tradeCount: executed.length,
    skippedCount: trades.length - executed.length,
    unpricedCount: scoredCalls.length - tradable.length,
    winRatePct: executed.length > 0 ? (wins.length / executed.length) * 100 : null,
    bestTrade: executed.reduce(pickBest, null),
    worstTrade: executed.reduce(pickWorst, null),
    maxDrawdownPct: maxDrawdown(equityCurve.map((point) => point.equity)),
    trades: executed,
    equityCurve,
  };
}

function pickBest(best, trade) {
  return best === null || trade.pnlUsd > best.pnlUsd ? trade : best;
}

function pickWorst(worst, trade) {
  return worst === null || trade.pnlUsd < worst.pnlUsd ? trade : worst;
}

/** @param {number[]} series */
export function maxDrawdown(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of series) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const drop = ((value - peak) / peak) * 100;
      if (drop < worst) worst = drop;
    }
  }
  return worst;
}
