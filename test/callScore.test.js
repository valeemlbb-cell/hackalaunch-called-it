import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCall,
  candleAtOrAfter,
  candleAtOrBefore,
  percentChange,
  median,
  mean,
} from '../src/score/callScore.js';

const HOUR = 3600;
const T0 = 1_750_000_000;

/**
 * Deterministic candles: index i sits at T0 + i hours with close `closes[i]`.
 * Highs are +10%, lows -10% of the close unless overridden.
 */
function candles(closes, overrides = {}) {
  return closes.map((close, index) => ({
    t: T0 + index * HOUR,
    o: close,
    h: overrides.highs?.[index] ?? close * 1.1,
    l: overrides.lows?.[index] ?? close * 0.9,
    c: close,
    v: 1000,
  }));
}

test('candleAtOrAfter finds the first candle at or past the target', () => {
  const series = candles([1, 2, 3, 4]);
  assert.equal(candleAtOrAfter(series, T0 + HOUR).c, 2);
  assert.equal(candleAtOrAfter(series, T0 + HOUR + 1).c, 3);
  assert.equal(candleAtOrAfter(series, T0 + 99 * HOUR), null);
});

test('candleAtOrBefore finds the last candle at or before the target', () => {
  const series = candles([1, 2, 3, 4]);
  assert.equal(candleAtOrBefore(series, T0 + 2 * HOUR).c, 3);
  assert.equal(candleAtOrBefore(series, T0 - 1), null);
});

test('percentChange handles the degenerate cases', () => {
  assert.equal(percentChange(100, 150), 50);
  assert.equal(percentChange(0, 10), null);
  assert.equal(percentChange(-1, 10), null);
});

test('scoreCall enters after the delay, never at the pre-call price', () => {
  // Call lands at T0; entry delay pushes us to the candle at T0 + 1h (close 200).
  const series = candles([100, 200, 300]);
  const result = scoreCall({ calledAt: T0 + 1 }, series, { horizonsHours: [1], entryDelayMinutes: 5 });
  assert.equal(result.scored, true);
  assert.equal(result.entryPrice, 200, 'entry is the first candle ending after call+delay');
  assert.equal(result.entryAt, T0 + HOUR);
});

test('scoreCall computes return, peak and trough over the horizon', () => {
  // entry 100 at T0, then 120 and 150 within 2h. highs are +10% of close.
  const series = candles([100, 120, 150]);
  const result = scoreCall({ calledAt: T0 - 600 }, series, { horizonsHours: [2], entryDelayMinutes: 0 });
  assert.equal(result.entryPrice, 100);
  const leg = result.horizons.h2;
  assert.equal(leg.candles, 2);
  assert.equal(Math.round(leg.returnPct), 50);
  assert.equal(Math.round(leg.maxGainPct), 65, 'peak uses the candle high (150 * 1.1)');
  assert.equal(Math.round(leg.maxDrawdownPct), 8, 'trough uses the lowest low (120 * 0.9)');
});

test('scoreCall marks a hit only when the headline horizon return is positive', () => {
  const up = scoreCall({ calledAt: T0 - 600 }, candles([100, 130]), { horizonsHours: [1], entryDelayMinutes: 0 });
  const down = scoreCall({ calledAt: T0 - 600 }, candles([100, 70]), { horizonsHours: [1], entryDelayMinutes: 0 });
  assert.equal(up.hit, true);
  assert.equal(down.hit, false);
});

test('scoreCall refuses to score instead of returning a fake zero', () => {
  assert.deepEqual(scoreCall({ calledAt: T0 }, []), { scored: false, reason: 'no-price-data' });
  assert.deepEqual(scoreCall({ calledAt: null }, candles([1, 2])), { scored: false, reason: 'no-call-timestamp' });

  // Call is newer than every candle we have.
  const late = scoreCall({ calledAt: T0 + 50 * HOUR }, candles([1, 2, 3]));
  assert.equal(late.scored, false);
  assert.equal(late.reason, 'call-newer-than-price-data');
});

test('scoreCall reports null legs for horizons with no candles yet', () => {
  const result = scoreCall({ calledAt: T0 - 600 }, candles([100, 110]), {
    horizonsHours: [1, 24],
    entryDelayMinutes: 0,
  });
  assert.equal(Math.round(result.horizons.h1.returnPct), 10);
  assert.equal(result.horizons.h24.candles, 1, 'only the data we have counts toward the 24h leg');
  assert.equal(result.headlineHorizonHours, 24);
});

test('median and mean ignore non-numbers and handle empty input', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, NaN, 5]), 5);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean(['x']), null);
});
