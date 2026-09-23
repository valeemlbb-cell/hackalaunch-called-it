/**
 * Aggregate scored calls into a KOL report card. Pure, unit tested.
 *
 * Grading is deliberately blunt and published in the README so nobody has to
 * guess: it is hit rate first, median 24h return as the tie-breaker, and a
 * confidence floor so an account with 3 lucky calls cannot score an A.
 */

import { median, mean } from './callScore.js';

export const MIN_CALLS_FOR_CONFIDENCE = 8;

/**
 * @typedef {{
 *   call: {handle:string, contract:string, chain:string, symbol?:string|null, calledAt:number, tweetUrl?:string|null},
 *   score: ReturnType<import('./callScore.js').scoreCall>,
 *   walletCheck?: {holdsNow:boolean|null, wallets:Array<{address:string, uiAmount:number}>}|null
 * }} ScoredCall
 */

/**
 * @param {ScoredCall[]} scoredCalls
 * @param {{handle:string, headlineHorizonHours?:number}} context
 */
export function buildReportCard(scoredCalls, context) {
  const headline = context.headlineHorizonHours ?? 24;
  const key = `h${headline}`;

  const scored = scoredCalls.filter((entry) => entry.score?.scored);
  const unscored = scoredCalls.filter((entry) => !entry.score?.scored);

  const returns = scored.map((entry) => entry.score.horizons?.[key]?.returnPct).filter(isNumber);
  const maxGains = scored.map((entry) => entry.score.horizons?.[key]?.maxGainPct).filter(isNumber);
  const drawdowns = scored.map((entry) => entry.score.horizons?.[key]?.maxDrawdownPct).filter(isNumber);
  const hits = scored.filter((entry) => entry.score.hit === true).length;
  const decided = scored.filter((entry) => entry.score.hit === true || entry.score.hit === false).length;

  const hitRate = decided > 0 ? (hits / decided) * 100 : null;
  const medianReturnPct = median(returns);

  const ranked = [...scored].sort(
    (a, b) => (b.score.horizons?.[key]?.returnPct ?? -Infinity) - (a.score.horizons?.[key]?.returnPct ?? -Infinity),
  );

  const talkVsTrade = scored.filter(
    (entry) => entry.walletCheck && entry.walletCheck.holdsNow === false && entry.walletCheck.wallets.length > 0,
  );

  return {
    handle: context.handle,
    generatedAt: new Date().toISOString(),
    headlineHorizonHours: headline,
    totals: {
      calls: scoredCalls.length,
      scored: scored.length,
      unscored: unscored.length,
      decided,
      hits,
    },
    unscoredReasons: countBy(unscored.map((entry) => entry.score?.reason ?? 'unknown')),
    hitRatePct: hitRate,
    medianReturnPct,
    meanReturnPct: mean(returns),
    medianMaxGainPct: median(maxGains),
    medianMaxDrawdownPct: median(drawdowns),
    grade: grade({ hitRatePct: hitRate, medianReturnPct, sampleSize: decided }),
    confidence: decided >= MIN_CALLS_FOR_CONFIDENCE ? 'ok' : 'low-sample',
    bestCall: ranked[0] ?? null,
    worstCall: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    talkVsTradeFlags: talkVsTrade.map((entry) => ({
      contract: entry.call.contract,
      symbol: entry.call.symbol ?? null,
      calledAt: entry.call.calledAt,
      returnPct: entry.score.horizons?.[key]?.returnPct ?? null,
      wallets: entry.walletCheck.wallets.map((wallet) => wallet.address),
    })),
    calls: scoredCalls,
  };
}

/**
 * A..F from hit rate with median return as tie-break. Capped at C when the
 * sample is too small to mean anything.
 * @param {{hitRatePct:number|null, medianReturnPct:number|null, sampleSize:number}} input
 */
export function grade({ hitRatePct, medianReturnPct, sampleSize }) {
  if (hitRatePct === null || sampleSize === 0) return 'N/A';

  let letter = 'F';
  if (hitRatePct >= 70) letter = 'A';
  else if (hitRatePct >= 55) letter = 'B';
  else if (hitRatePct >= 45) letter = 'C';
  else if (hitRatePct >= 30) letter = 'D';

  // A good hit rate on tiny median returns is noise, not skill.
  if (letter === 'A' && (medianReturnPct ?? 0) < 5) letter = 'B';

  if (sampleSize < MIN_CALLS_FOR_CONFIDENCE && (letter === 'A' || letter === 'B')) return 'C';
  return letter;
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** @param {string[]} values */
export function countBy(values) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}
