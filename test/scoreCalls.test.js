import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCalls, unpriceableReason, candleLimit, checkHoldings } from '../src/score/scoreCalls.js';
import { slugify } from '../src/cli.js';

const HOUR = 3600;
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Ascending hourly candles that double in price over the window. */
function candles(startSeconds, count) {
  return Array.from({ length: count }, (_, index) => {
    const price = 1 + index / count;
    return { t: startSeconds + index * HOUR, o: price, h: price * 1.1, l: price * 0.9, c: price, v: 100 };
  });
}

function fakeGecko({ pool = { poolAddress: 'pool1', name: 'SOL/USDC' }, bars = null } = {}) {
  return {
    calls: [],
    async topPool(chain, contract) {
      this.calls.push({ chain, contract });
      return pool;
    },
    async candles() {
      return bars ?? candles(Math.floor(Date.now() / 1000) - 48 * HOUR, 60);
    },
  };
}

test('scores a priceable call against the candles it was given', async () => {
  // Arrange
  const call = { contract: SOL_MINT, chain: 'solana', calledAt: Math.floor(Date.now() / 1000) - 48 * HOUR };

  // Act
  const [scored] = await scoreCalls({ calls: [call], gecko: fakeGecko() });

  // Assert
  assert.equal(scored.score.scored, true);
  assert.equal(scored.pool.address, 'pool1');
  assert.equal(typeof scored.score.horizons.h24.returnPct, 'number');
});

test('marks an unsupported chain unscored instead of scoring it zero', async () => {
  const call = { contract: SOL_MINT, chain: 'ethereum', calledAt: Math.floor(Date.now() / 1000) - HOUR };
  const [scored] = await scoreCalls({ calls: [call], gecko: fakeGecko() });
  assert.equal(scored.score.scored, false);
  assert.equal(scored.score.reason, 'unsupported-chain');
});

test('marks a call with no pool unscored and never asks for candles', async () => {
  // Arrange
  const gecko = fakeGecko({ pool: null });
  let candleCalls = 0;
  gecko.candles = async () => {
    candleCalls += 1;
    return [];
  };

  // Act
  const [scored] = await scoreCalls({
    calls: [{ contract: SOL_MINT, chain: 'solana', calledAt: Math.floor(Date.now() / 1000) - HOUR }],
    gecko,
  });

  // Assert
  assert.equal(scored.score.reason, 'no-pool-found');
  assert.equal(candleCalls, 0);
});

test('skips a call older than the public price window', async () => {
  const old = Math.floor(Date.now() / 1000) - 200 * 24 * HOUR;
  const [scored] = await scoreCalls({ calls: [{ contract: SOL_MINT, chain: 'solana', calledAt: old }], gecko: fakeGecko() });
  assert.equal(scored.score.reason, 'older-than-180d-price-window');
});

test('only runs the holdings check for Solana calls when wallets are supplied', async () => {
  // Arrange
  const asked = [];
  const solana = {
    async tokenBalance(address, mint) {
      asked.push({ address, mint });
      return { uiAmount: 0, accounts: 1 };
    },
  };
  const calledAt = Math.floor(Date.now() / 1000) - 48 * HOUR;

  // Act
  const scored = await scoreCalls({
    calls: [
      { contract: SOL_MINT, chain: 'solana', calledAt },
      { contract: '0x' + 'b'.repeat(40), chain: 'bsc', calledAt },
    ],
    gecko: fakeGecko(),
    solana,
    wallets: [{ address: 'WalletOne' }],
  });

  // Assert
  assert.equal(asked.length, 1);
  assert.equal(scored[0].walletCheck.holdsNow, false);
  assert.equal(scored[1].walletCheck, null);
});

test('checkHoldings reports unknown rather than false when every lookup fails', async () => {
  const solana = {
    async tokenBalance() {
      throw new Error('rpc down');
    },
  };
  const result = await checkHoldings(solana, [{ address: 'W1' }], SOL_MINT);
  assert.equal(result.holdsNow, null);
  assert.equal(result.wallets[0].error, 'rpc down');
});

test('unpriceableReason passes a supported recent call', () => {
  assert.equal(unpriceableReason({ chain: 'solana', calledAt: Math.floor(Date.now() / 1000) - HOUR }), null);
});

test('candleLimit covers the call age plus the horizon and stays within the API cap', () => {
  const now = 1_000_000_000;
  assert.equal(candleLimit(now - 10 * HOUR, 24, now), 10 + 24 + 2 + 5);
  assert.equal(candleLimit(now - 5000 * HOUR, 24, now), 1000);
});

test('slugify keeps filenames boring and refuses path traversal', () => {
  assert.equal(slugify('@SomeKOL'), 'somekol');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('...'), 'report');
  assert.equal(slugify('/'.repeat(10)), 'report');
});

test('a price-API failure downgrades that one call and lets the report finish', async () => {
  // Arrange
  const calledAt = Math.floor(Date.now() / 1000) - 48 * HOUR;
  let seen = 0;
  const gecko = fakeGecko();
  gecko.topPool = async () => {
    seen += 1;
    if (seen === 1) {
      const error = new Error('HTTP 429 for https://example.test');
      error.status = 429;
      throw error;
    }
    return { poolAddress: 'pool1', name: 'X/USDC' };
  };

  // Act
  const scored = await scoreCalls({
    calls: [
      { contract: SOL_MINT, chain: 'solana', calledAt },
      { contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', chain: 'solana', calledAt },
    ],
    gecko,
  });

  // Assert
  assert.equal(scored.length, 2);
  assert.equal(scored[0].score.reason, 'price-lookup-failed:429');
  assert.equal(scored[1].score.scored, true);
});
