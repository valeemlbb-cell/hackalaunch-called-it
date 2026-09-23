/**
 * Live network tests for the on-chain half of the pipeline. These hit real
 * public endpoints (GeckoTerminal + a Solana RPC), need no API key, and are
 * kept out of `npm test` so the offline suite stays deterministic.
 *
 *   npm run test:live
 *
 * They exist to prove the price and balance paths are real, not simulated.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { GeckoTerminalClient, isBeyondHistoryWindow, OHLCV_HISTORY_DAYS } from '../../src/onchain/geckoterminal.js';
import { SolanaReader } from '../../src/onchain/solana.js';
import { scoreCall } from '../../src/score/callScore.js';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WSOL = 'So11111111111111111111111111111111111111112';
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

test('GeckoTerminal returns a real pool for a known Solana mint', async () => {
  const gecko = new GeckoTerminalClient();
  const pool = await gecko.topPool('solana', BONK);
  assert.ok(pool, 'expected a pool');
  assert.match(pool.poolAddress, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.ok(pool.liquidityUsd > 0);
});

test('GeckoTerminal returns usable hourly candles', async () => {
  const gecko = new GeckoTerminalClient();
  const pool = await gecko.topPool('solana', BONK);
  const candles = await gecko.candles('solana', pool.poolAddress, { timeframe: 'hour', limit: 48 });

  assert.ok(candles.length > 24, `expected candles, got ${candles.length}`);
  for (const candle of candles) {
    assert.ok(candle.h >= candle.l, 'high must be >= low');
    assert.ok(candle.c > 0);
  }
  for (let index = 1; index < candles.length; index += 1) {
    assert.ok(candles[index].t > candles[index - 1].t, 'candles must be ascending');
  }
});

test('a call scored against real candles produces a real number', async () => {
  const gecko = new GeckoTerminalClient();
  const pool = await gecko.topPool('solana', BONK);
  const candles = await gecko.candles('solana', pool.poolAddress, { timeframe: 'hour', limit: 72 });

  // Pretend the call landed at the third candle, then score it forward.
  const calledAt = candles[2].t;
  const result = scoreCall({ calledAt, contract: BONK }, candles, { horizonsHours: [1, 24], entryDelayMinutes: 5 });

  assert.equal(result.scored, true, result.reason);
  assert.ok(Number.isFinite(result.entryPrice) && result.entryPrice > 0);
  assert.ok(Number.isFinite(result.horizons.h24.returnPct));
  assert.ok(result.horizons.h24.maxGainPct >= result.horizons.h24.returnPct - 1e-9, 'peak cannot be below the exit');
});

test('unknown mints fail closed instead of inventing a pool', async () => {
  const gecko = new GeckoTerminalClient();
  const pool = await gecko.topPool('solana', '11111111111111111111111111111111');
  assert.equal(pool, null);
});

test('the public OHLCV window is enforced before we waste a request', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(isBeyondHistoryWindow(now - 86_400), false);
  assert.equal(isBeyondHistoryWindow(now - (OHLCV_HISTORY_DAYS + 5) * 86_400), true);
});

test('Solana RPC answers read-only calls', async () => {
  const reader = new SolanaReader({ rpcUrl: RPC });
  assert.equal(await reader.health(), 'ok');

  // A wallet that holds nothing of this mint returns a clean zero, not an error.
  const balance = await reader.tokenBalance(WSOL, BONK);
  assert.ok(Number.isFinite(balance.uiAmount));
  assert.ok(balance.uiAmount >= 0);
});
