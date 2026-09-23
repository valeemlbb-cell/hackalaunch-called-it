import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportCard, grade, countBy, MIN_CALLS_FOR_CONFIDENCE } from '../src/score/reportCard.js';
import { renderReportCard } from '../src/report/text.js';
import { renderHtml } from '../src/report/html.js';

/**
 * @param {number|null} returnPct
 * @param {{holds?:boolean|null, calledAt?:number}} [extra]
 */
function entry(returnPct, extra = {}) {
  const scored = returnPct !== null;
  return {
    call: {
      handle: 'someone',
      contract: `mint${Math.random().toString(36).slice(2, 8)}`,
      chain: 'solana',
      symbol: 'TKN',
      calledAt: extra.calledAt ?? 1_750_000_000,
      tweetUrl: null,
    },
    score: scored
      ? {
          scored: true,
          entryPrice: 1,
          entryAt: 1_750_000_000,
          headlineHorizonHours: 24,
          hit: returnPct > 0,
          horizons: {
            h24: { hours: 24, returnPct, maxGainPct: returnPct + 20, maxDrawdownPct: -10, exitAt: 1, exitPrice: 1, candles: 24 },
          },
        }
      : { scored: false, reason: 'no-pool-found' },
    walletCheck:
      extra.holds === undefined ? null : { holdsNow: extra.holds, wallets: [{ address: 'WalletAAA', uiAmount: 0 }] },
  };
}

test('buildReportCard separates scored from unscored calls', () => {
  const card = buildReportCard([entry(10), entry(null), entry(-5)], { handle: 'kol' });
  assert.equal(card.totals.calls, 3);
  assert.equal(card.totals.scored, 2);
  assert.equal(card.totals.unscored, 1);
  assert.deepEqual(card.unscoredReasons, { 'no-pool-found': 1 });
});

test('buildReportCard computes hit rate over decided calls only', () => {
  const card = buildReportCard([entry(10), entry(20), entry(-5), entry(null)], { handle: 'kol' });
  assert.equal(card.totals.decided, 3);
  assert.equal(Math.round(card.hitRatePct), 67);
  assert.equal(card.medianReturnPct, 10);
});

test('buildReportCard ranks best and worst call', () => {
  const card = buildReportCard([entry(10), entry(90), entry(-30)], { handle: 'kol' });
  assert.equal(card.bestCall.score.horizons.h24.returnPct, 90);
  assert.equal(card.worstCall.score.horizons.h24.returnPct, -30);
});

test('buildReportCard flags talk-vs-trade only when wallets hold nothing', () => {
  const card = buildReportCard([entry(10, { holds: false }), entry(20, { holds: true }), entry(5)], { handle: 'kol' });
  assert.equal(card.talkVsTradeFlags.length, 1);
  assert.deepEqual(card.talkVsTradeFlags[0].wallets, ['WalletAAA']);
});

test('buildReportCard returns nulls, not zeros, when nothing could be scored', () => {
  const card = buildReportCard([entry(null), entry(null)], { handle: 'kol' });
  assert.equal(card.hitRatePct, null);
  assert.equal(card.medianReturnPct, null);
  assert.equal(card.grade, 'N/A');
});

test('grade maps hit rate to a letter', () => {
  const big = MIN_CALLS_FOR_CONFIDENCE;
  assert.equal(grade({ hitRatePct: 80, medianReturnPct: 30, sampleSize: big }), 'A');
  assert.equal(grade({ hitRatePct: 60, medianReturnPct: 10, sampleSize: big }), 'B');
  assert.equal(grade({ hitRatePct: 50, medianReturnPct: 1, sampleSize: big }), 'C');
  assert.equal(grade({ hitRatePct: 35, medianReturnPct: -5, sampleSize: big }), 'D');
  assert.equal(grade({ hitRatePct: 10, medianReturnPct: -40, sampleSize: big }), 'F');
});

test('grade demotes a high hit rate that only produced noise-sized returns', () => {
  assert.equal(grade({ hitRatePct: 90, medianReturnPct: 1, sampleSize: 20 }), 'B');
});

test('grade caps a small sample at C so three lucky calls cannot score an A', () => {
  assert.equal(grade({ hitRatePct: 100, medianReturnPct: 50, sampleSize: 3 }), 'C');
  assert.equal(grade({ hitRatePct: 20, medianReturnPct: -50, sampleSize: 3 }), 'F', 'bad grades are not capped');
});

test('confidence reports low-sample honestly', () => {
  const small = buildReportCard([entry(10), entry(20)], { handle: 'kol' });
  assert.equal(small.confidence, 'low-sample');
  const big = buildReportCard(Array.from({ length: 10 }, () => entry(10)), { handle: 'kol' });
  assert.equal(big.confidence, 'ok');
});

test('countBy tallies reasons', () => {
  assert.deepEqual(countBy(['a', 'b', 'a']), { a: 2, b: 1 });
});

test('renders a card from a local call list, which has no Frontrun call log', () => {
  // Arrange - the list path sets no sources.frontrunCalls at all.
  const card = buildReportCard(
    [{ call: { contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', chain: 'solana', calledAt: 1_750_000_000, symbol: 'BONK' }, score: { scored: false, reason: 'no-pool-found' }, walletCheck: null }],
    { handle: 'sample-list', headlineHorizonHours: 24 },
  );
  card.sources = { callSource: 'local call list (no Frontrun key used)', priceData: 'GeckoTerminal', onchain: 'disabled' };
  card.linkedWallets = [];

  // Act
  const text = renderReportCard(card);
  const html = renderHtml(card, null);

  // Assert
  assert.match(text, /call source: local call list/);
  assert.doesNotMatch(text, /Frontrun API calls this run/);
  assert.match(html, /Call source: local call list/);
});
