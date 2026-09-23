/**
 * The pipeline that turns a Twitter handle into a report card.
 *
 *   Frontrun caHistory (social)  ->  every contract this handle called
 *   Frontrun linkedWallets (wallet) + walletLabels
 *          -> who they are on-chain
 *   GeckoTerminal OHLCV          -> what the price actually did after the call
 *   Solana RPC (read-only)       -> do those wallets still hold the token
 *
 * Nothing here invents data. If Frontrun does not answer, the run fails loudly.
 */

import { GeckoTerminalClient, isBeyondHistoryWindow } from './onchain/geckoterminal.js';
import { SolanaReader } from './onchain/solana.js';
import { scoreCall, DEFAULT_HORIZONS_HOURS, DEFAULT_ENTRY_DELAY_MINUTES } from './score/callScore.js';
import { buildReportCard } from './score/reportCard.js';

const SECONDS_PER_HOUR = 3600;

/**
 * @param {import('./frontrun/client.js').FrontrunClient} frontrun
 * @param {string} handle
 * @param {{
 *   maxCalls?:number, horizonsHours?:number[], entryDelayMinutes?:number,
 *   checkWallets?:boolean, solanaRpcUrl?:string, geckoTerminalBaseUrl?:string,
 *   log?:(message:string)=>void
 * }} [options]
 */
export async function buildKolReport(frontrun, handle, options = {}) {
  const {
    maxCalls = 40,
    horizonsHours = DEFAULT_HORIZONS_HOURS,
    entryDelayMinutes = DEFAULT_ENTRY_DELAY_MINUTES,
    checkWallets = true,
    solanaRpcUrl,
    geckoTerminalBaseUrl,
    log = () => {},
  } = options;

  const gecko = new GeckoTerminalClient({ baseUrl: geckoTerminalBaseUrl });
  const solana = solanaRpcUrl ? new SolanaReader({ rpcUrl: solanaRpcUrl }) : null;

  log(`frontrun: caHistory(${handle})`);
  const history = await frontrun.caHistory(handle, { limit: Math.max(maxCalls, 50) });

  log(`frontrun: linkedWallets(${handle})`);
  const linked = await frontrun.linkedWallets(handle).catch((error) => {
    log(`  linkedWallets unavailable: ${error.message}`);
    return { items: [] };
  });

  const solanaWallets = linked.items.filter((wallet) => wallet.chain === 'solana').slice(0, 5);

  const labelled = [];
  for (const wallet of solanaWallets) {
    try {
      log(`frontrun: walletLabels(${wallet.address.slice(0, 6)}...)`);
      const labels = await frontrun.walletLabels(wallet.address, { chain: 'solana' });
      labelled.push({ ...wallet, labels: labels.items });
    } catch (error) {
      labelled.push({ ...wallet, labels: [], labelError: error.message });
    }
  }

  const horizonMax = Math.max(...horizonsHours);
  const calls = history.items.slice(0, maxCalls);
  const scoredCalls = [];

  for (const call of calls) {
    if (call.chain !== 'solana' && call.chain !== 'bsc') {
      scoredCalls.push({ call, score: { scored: false, reason: 'unsupported-chain' }, walletCheck: null });
      continue;
    }
    if (isBeyondHistoryWindow(call.calledAt)) {
      scoredCalls.push({ call, score: { scored: false, reason: 'older-than-180d-price-window' }, walletCheck: null });
      continue;
    }

    const pool = await gecko.topPool(call.chain, call.contract);
    if (!pool) {
      scoredCalls.push({ call, score: { scored: false, reason: 'no-pool-found' }, walletCheck: null });
      continue;
    }

    const ageHours = (Date.now() / 1000 - call.calledAt) / SECONDS_PER_HOUR;
    const needHours = ageHours + horizonMax + 2;
    const candles = await gecko.candles(call.chain, pool.poolAddress, {
      timeframe: 'hour',
      aggregate: 1,
      limit: Math.min(Math.ceil(needHours) + 5, 1000),
    });

    const score = scoreCall(call, candles, { horizonsHours, entryDelayMinutes });

    let walletCheck = null;
    if (checkWallets && solana && call.chain === 'solana' && solanaWallets.length > 0) {
      walletCheck = await checkHoldings(solana, solanaWallets, call.contract);
    }

    scoredCalls.push({ call, score, walletCheck, pool: { address: pool.poolAddress, name: pool.name } });
    log(
      `scored ${call.symbol ?? call.contract.slice(0, 6)} @ ${new Date(call.calledAt * 1000).toISOString()} -> ${
        score.scored ? `${fmt(score.horizons?.[`h${horizonMax}`]?.returnPct)}% @${horizonMax}h` : score.reason
      }`,
    );
  }

  const card = buildReportCard(scoredCalls, { handle, headlineHorizonHours: horizonMax });

  return {
    ...card,
    linkedWallets: labelled,
    sources: {
      frontrunCalls: frontrun.callLog,
      priceData: 'GeckoTerminal public API (OHLCV, hourly, USD)',
      onchain: solana ? 'Solana JSON-RPC (read-only: getTokenAccountsByOwner)' : 'disabled',
    },
  };
}

/**
 * @param {SolanaReader} solana
 * @param {Array<{address:string}>} wallets
 * @param {string} mint
 */
async function checkHoldings(solana, wallets, mint) {
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

function fmt(value) {
  return typeof value === 'number' ? value.toFixed(1) : '?';
}
