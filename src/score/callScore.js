/**
 * Scoring a single call. Pure functions only - no I/O, fully unit tested.
 *
 * The honest-measurement rules, chosen before any data was looked at:
 *  - Entry is the close of the first candle that ENDS at or after
 *    callTime + entryDelayMinutes. You cannot buy at the price printed in the
 *    same second the tweet lands, so we never use the pre-call price.
 *  - Peak and trough use candle highs/lows, so max-gain is the best a trader
 *    could have got, not a cherry-picked close.
 *  - Exit return uses the close nearest the horizon, not the peak.
 *  - A call with no candle at or after entry is UNSCORED, never a zero.
 */

export const DEFAULT_HORIZONS_HOURS = [1, 6, 24];
export const DEFAULT_ENTRY_DELAY_MINUTES = 5;
/** A call "hit" when the exit-horizon return clears this. */
export const DEFAULT_HIT_THRESHOLD_PCT = 0;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

/**
 * @typedef {{t:number,o:number,h:number,l:number,c:number,v:number}} Candle
 */

/**
 * First candle whose timestamp is >= target.
 * @param {Candle[]} candles ascending by t
 * @param {number} targetSeconds
 * @returns {Candle|null}
 */
export function candleAtOrAfter(candles, targetSeconds) {
  let lo = 0;
  let hi = candles.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t >= targetSeconds) {
      found = candles[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

/**
 * Last candle whose timestamp is <= target.
 * @param {Candle[]} candles ascending by t
 * @param {number} targetSeconds
 * @returns {Candle|null}
 */
export function candleAtOrBefore(candles, targetSeconds) {
  let lo = 0;
  let hi = candles.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= targetSeconds) {
      found = candles[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** @param {number} from @param {number} to */
export function percentChange(from, to) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 100;
}

/**
 * Score one call against real candles.
 *
 * @param {{calledAt:number, contract?:string, symbol?:string, handle?:string, tweetUrl?:string|null}} call
 * @param {Candle[]} candles ascending, covering at least entry..horizon
 * @param {{horizonsHours?:number[], entryDelayMinutes?:number, hitThresholdPct?:number}} [options]
 * @returns {{
 *   scored:boolean, reason?:string, entryPrice?:number, entryAt?:number,
 *   horizons?:Record<string,{returnPct:number|null, maxGainPct:number|null, maxDrawdownPct:number|null, exitAt:number|null, exitPrice:number|null, candles:number}>,
 *   hit?:boolean, headlineHorizonHours?:number
 * }}
 */
export function scoreCall(call, candles, options = {}) {
  const {
    horizonsHours = DEFAULT_HORIZONS_HOURS,
    entryDelayMinutes = DEFAULT_ENTRY_DELAY_MINUTES,
    hitThresholdPct = DEFAULT_HIT_THRESHOLD_PCT,
  } = options;

  if (!Array.isArray(candles) || candles.length === 0) {
    return { scored: false, reason: 'no-price-data' };
  }
  if (!Number.isFinite(call?.calledAt)) {
    return { scored: false, reason: 'no-call-timestamp' };
  }

  const entryTarget = call.calledAt + entryDelayMinutes * SECONDS_PER_MINUTE;
  const entryCandle = candleAtOrAfter(candles, entryTarget);
  if (!entryCandle) {
    return { scored: false, reason: 'call-newer-than-price-data' };
  }
  const entryPrice = entryCandle.c;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { scored: false, reason: 'bad-entry-price' };
  }

  /** @type {Record<string, any>} */
  const horizons = {};
  const sortedHorizons = [...horizonsHours].sort((a, b) => a - b);

  for (const hours of sortedHorizons) {
    const windowEnd = entryCandle.t + hours * SECONDS_PER_HOUR;
    const window = candles.filter((candle) => candle.t > entryCandle.t && candle.t <= windowEnd);
    const exitCandle = window.length > 0 ? window[window.length - 1] : null;

    const highs = window.map((candle) => candle.h).filter(Number.isFinite);
    const lows = window.map((candle) => candle.l).filter(Number.isFinite);

    horizons[`h${hours}`] = {
      hours,
      candles: window.length,
      exitAt: exitCandle ? exitCandle.t : null,
      exitPrice: exitCandle ? exitCandle.c : null,
      returnPct: exitCandle ? percentChange(entryPrice, exitCandle.c) : null,
      maxGainPct: highs.length > 0 ? percentChange(entryPrice, Math.max(...highs)) : null,
      maxDrawdownPct: lows.length > 0 ? percentChange(entryPrice, Math.min(...lows)) : null,
    };
  }

  const headline = sortedHorizons[sortedHorizons.length - 1];
  const headlineReturn = horizons[`h${headline}`]?.returnPct;

  return {
    scored: true,
    entryAt: entryCandle.t,
    entryPrice,
    horizons,
    headlineHorizonHours: headline,
    hit: typeof headlineReturn === 'number' ? headlineReturn > hitThresholdPct : null,
  };
}

/** @param {number[]} values */
export function median(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
}

/** @param {number[]} values */
export function mean(values) {
  const clean = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}
