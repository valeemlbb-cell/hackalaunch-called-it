import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaperBacktest, maxDrawdown, DEFAULT_BACKTEST } from '../src/score/paperBacktest.js';

function entry(returnPct, calledAt = 1_750_000_000) {
  const scored = returnPct !== null;
  return {
    call: { contract: 'mintX', symbol: 'TKN', calledAt, tweetUrl: null, chain: 'solana', handle: 'kol' },
    score: scored
      ? {
          scored: true,
          entryPrice: 1,
          entryAt: calledAt,
          horizons: { h24: { returnPct, exitPrice: 1 + returnPct / 100, exitAt: calledAt + 86_400 } },
        }
      : { scored: false, reason: 'no-pool-found' },
  };
}

test('backtest applies fee and slippage on both sides', () => {
  const result = runPaperBacktest([entry(0)], {
    bankrollUsd: 1000,
    positionUsd: 100,
    feeBps: 30,
    slippageBps: 100,
    exitHorizonHours: 24,
  });
  // A flat trade still loses two rounds of costs: (1 - 0.013)^2 - 1 = -2.583%.
  assert.equal(result.tradeCount, 1);
  assert.ok(result.trades[0].netReturnPct < 0, 'a flat call is a loss after costs');
  assert.ok(Math.abs(result.trades[0].netReturnPct + 2.583) < 0.01);
});

test('backtest compounds pnl across trades and reports a win rate', () => {
  const result = runPaperBacktest([entry(50), entry(-20), entry(100)], {
    bankrollUsd: 1000,
    positionUsd: 100,
    feeBps: 0,
    slippageBps: 0,
    exitHorizonHours: 24,
  });
  assert.equal(result.tradeCount, 3);
  assert.equal(Math.round(result.realisedPnlUsd), 130);
  assert.equal(Math.round(result.endingBankrollUsd), 1130);
  assert.equal(Math.round(result.winRatePct), 67);
});

test('backtest skips unpriced calls instead of counting them as break-even', () => {
  const result = runPaperBacktest([entry(10), entry(null), entry(null)], { feeBps: 0, slippageBps: 0 });
  assert.equal(result.tradeCount, 1);
  assert.equal(result.unpricedCount, 2);
});

test('backtest stops opening positions once the bankroll is gone', () => {
  const result = runPaperBacktest([entry(-100), entry(-100), entry(50)], {
    bankrollUsd: 100,
    positionUsd: 100,
    feeBps: 0,
    slippageBps: 0,
  });
  assert.equal(result.tradeCount, 1, 'one trade wiped the bankroll');
  assert.equal(result.skippedCount, 2);
  assert.equal(Math.round(result.endingBankrollUsd), 0);
});

test('backtest trades in call order, oldest first', () => {
  const result = runPaperBacktest([entry(10, 2_000), entry(20, 1_000)], { feeBps: 0, slippageBps: 0 });
  assert.equal(result.trades[0].calledAt, 1_000);
});

test('backtest is always labelled paper mode', () => {
  const result = runPaperBacktest([entry(10)]);
  assert.equal(result.mode, 'paper');
  assert.equal(result.settings.bankrollUsd, DEFAULT_BACKTEST.bankrollUsd);
});

test('maxDrawdown measures the worst peak-to-trough drop', () => {
  assert.equal(Math.round(maxDrawdown([100, 120, 60, 90])), -50);
  assert.equal(maxDrawdown([100, 110, 120]), 0);
  assert.equal(maxDrawdown([]), 0);
});
