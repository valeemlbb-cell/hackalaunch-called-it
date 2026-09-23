/**
 * The shared scoring loop: a list of calls in, scored calls out.
 *
 * Both entry points use this and nothing else, so a report built from Frontrun's
 * `caHistory` and a report built from a hand-written call list are graded by
 * identical code against identical data:
 *
 *   GeckoTerminal OHLCV  ->  what the price actually did after the call
 *   Solana JSON-RPC      ->  does the caller's wallet still hold it (read-only)
 *
 * Nothing here invents data. A call we cannot price is returned UNSCORED with a
 * reason, never as a zero.
 */

import { isBeyondHistoryWindow } from '../onchain/geckoterminal.js';
import { scoreCall, DEFAULT_HORIZONS_HOURS, DEFAULT_ENTRY_DELAY_MINUTES } from './callScore.js';

const SECONDS_PER_HOUR = 3600;
const SUPPORTED_CHAINS = new Set(['solana', 'bsc']);
/** Extra candles either side of the window, so a horizon never lands off the end. */
const CANDLE_HEADROOM = 5;
const MAX_CANDLES = 1000;

/**
 * @param {{
 *   calls: Array<{contract:string, chain:string, calledAt:number, symbol?:string|null}>,
 *   gecko: import('../onchain/geckoterminal.js').GeckoTerminalClient,
 *   solana?: import('../onchain/solana.js').SolanaReader|null,
 *   wallets?: Array<{address:string}>,
 *   horizonsHours?: number[],
 *   entryDelayMinutes?: number,
 *   log?: (message:string) => void,
 * }} input
 */
export async function scoreCalls({
  calls,
  gecko,
  solana = null,
  wallets = [],
  horizonsHours = DEFAULT_HORIZONS_HOURS,
  entryDelayMinutes = DEFAULT_ENTRY_DELAY_MINUTES,
  log = () => {},
}) {
  const horizonMax = Math.max(...horizonsHours);
  const scoredCalls = [];

  for (const call of calls) {
    const skip = unpriceableReason(call);
    if (skip) {
      scoredCalls.push({ call, score: { scored: false, reason: skip }, walletCheck: null });
      log(`skipped ${label(call)} -> ${skip}`);
      continue;
    }

    // One token the price API will not serve must not destroy the whole report:
    // that call goes back UNSCORED with the reason, and the run carries on.
    let pool;
    let candles;
    try {
      pool = await gecko.topPool(call.chain, call.contract);
      if (pool) {
        candles = await gecko.candles(call.chain, pool.poolAddress, {
          timeframe: 'hour',
          aggregate: 1,
          limit: candleLimit(call.calledAt, horizonMax),
        });
      }
    } catch (error) {
      const reason = `price-lookup-failed:${error.status ?? 'error'}`;
      scoredCalls.push({ call, score: { scored: false, reason, detail: error.message }, walletCheck: null });
      log(`skipped ${label(call)} -> ${reason}`);
      continue;
    }

    if (!pool) {
      scoredCalls.push({ call, score: { scored: false, reason: 'no-pool-found' }, walletCheck: null });
      log(`skipped ${label(call)} -> no-pool-found`);
      continue;
    }

    const score = scoreCall(call, candles, { horizonsHours, entryDelayMinutes });

    const walletCheck =
      solana && call.chain === 'solana' && wallets.length > 0
        ? await checkHoldings(solana, wallets, call.contract)
        : null;

    scoredCalls.push({ call, score, walletCheck, pool: { address: pool.poolAddress, name: pool.name } });
    log(
      `scored ${label(call)} @ ${new Date(call.calledAt * 1000).toISOString()} -> ${
        score.scored ? `${fmt(score.horizons?.[`h${horizonMax}`]?.returnPct)}% @${horizonMax}h` : score.reason
      }`,
    );
  }

  return scoredCalls;
}

/**
 * Why we cannot price this call at all, or null when we can try.
 * @param {{chain:string, calledAt:number}} call
 */
export function unpriceableReason(call) {
  if (!SUPPORTED_CHAINS.has(call.chain)) return 'unsupported-chain';
  if (isBeyondHistoryWindow(call.calledAt)) return 'older-than-180d-price-window';
  return null;
}

/**
 * Enough hourly candles to cover from the call to the far horizon, plus headroom.
 * @param {number} calledAtSeconds
 * @param {number} horizonMaxHours
 */
export function candleLimit(calledAtSeconds, horizonMaxHours, nowSeconds = Date.now() / 1000) {
  const ageHours = (nowSeconds - calledAtSeconds) / SECONDS_PER_HOUR;
  const needed = Math.ceil(ageHours + horizonMaxHours + 2) + CANDLE_HEADROOM;
  return Math.min(Math.max(needed, 1), MAX_CANDLES);
}

/**
 * Read-only holdings check: does any linked wallet still hold this mint today.
 * @param {import('../onchain/solana.js').SolanaReader} solana
 * @param {Array<{address:string}>} wallets
 * @param {string} mint
 */
export async function checkHoldings(solana, wallets, mint) {
  const results = [];
  for (const wallet of wallets) {
    try {
      const balance = await solana.tokenBalance(wallet.address, mint);
      results.push({ address: wallet.address, uiAmount: balance.uiAmount, accounts: balance.accounts });
    } catch (error) {
      results.push({ address: wallet.address, uiAmount: null, error: error.message });
    }
  }
  const known = results.filter((row) => typeof row.uiAmount === 'number');
  const holdsNow = known.length === 0 ? null : known.some((row) => row.uiAmount > 0);
  return { holdsNow, wallets: results };
}

function label(call) {
  return call.symbol ?? call.contract.slice(0, 6);
}

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(1) : '?';
}
