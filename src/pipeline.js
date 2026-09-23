/**
 * The two pipelines that produce a report card.
 *
 *   buildKolReport   - handle in. Calls come from Frontrun.
 *   buildListReport  - file in.   Calls come from a list you already have.
 *
 * Both then run the identical scoring loop (src/score/scoreCalls.js):
 *
 *   GeckoTerminal OHLCV  ->  what the price actually did after the call
 *   Solana RPC           ->  do the caller's wallets still hold the token
 *
 * Nothing here invents data. If Frontrun does not answer, the run fails loudly.
 */

import { GeckoTerminalClient } from './onchain/geckoterminal.js';
import { SolanaReader } from './onchain/solana.js';
import { DEFAULT_HORIZONS_HOURS, DEFAULT_ENTRY_DELAY_MINUTES } from './score/callScore.js';
import { scoreCalls } from './score/scoreCalls.js';
import { buildReportCard } from './score/reportCard.js';

/** Linked wallets we are willing to spend RPC calls on, per report. */
const MAX_LINKED_WALLETS = 5;

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

  const solanaWallets = linked.items
    .filter((wallet) => wallet.chain === 'solana')
    .slice(0, MAX_LINKED_WALLETS);

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

  const scoredCalls = await scoreCalls({
    calls: history.items.slice(0, maxCalls),
    gecko,
    solana: checkWallets ? solana : null,
    wallets: solanaWallets,
    horizonsHours,
    entryDelayMinutes,
    log,
  });

  const card = buildReportCard(scoredCalls, {
    handle,
    headlineHorizonHours: Math.max(...horizonsHours),
  });

  return {
    ...card,
    linkedWallets: labelled,
    sources: {
      callSource: 'Frontrun Data API caHistory',
      frontrunCalls: frontrun.callLog,
      priceData: 'GeckoTerminal public API (OHLCV, hourly, USD)',
      onchain: solana ? 'Solana JSON-RPC (read-only: getTokenAccountsByOwner)' : 'disabled',
    },
  };
}

/**
 * Score a list of calls you already have, with no Frontrun key.
 *
 * This is not a mock: the list only supplies (contract, calledAt) pairs, which
 * is exactly what caHistory supplies. Every price, return, peak and trough below
 * still comes from real GeckoTerminal candles.
 *
 * @param {import('./lib/callList.js').ListedCall[]} calls
 * @param {{
 *   label?:string, horizonsHours?:number[], entryDelayMinutes?:number,
 *   wallets?:string[], solanaRpcUrl?:string, geckoTerminalBaseUrl?:string,
 *   log?:(message:string)=>void
 * }} [options]
 */
export async function buildListReport(calls, options = {}) {
  const {
    label,
    horizonsHours = DEFAULT_HORIZONS_HOURS,
    entryDelayMinutes = DEFAULT_ENTRY_DELAY_MINUTES,
    wallets = [],
    solanaRpcUrl,
    geckoTerminalBaseUrl,
    log = () => {},
  } = options;

  const gecko = new GeckoTerminalClient({ baseUrl: geckoTerminalBaseUrl });
  const solana = wallets.length > 0 && solanaRpcUrl ? new SolanaReader({ rpcUrl: solanaRpcUrl }) : null;
  const walletObjects = wallets.slice(0, MAX_LINKED_WALLETS).map((address) => ({ address }));

  const scoredCalls = await scoreCalls({
    calls,
    gecko,
    solana,
    wallets: walletObjects,
    horizonsHours,
    entryDelayMinutes,
    log,
  });

  const handle = label ?? calls.find((call) => call.handle)?.handle ?? 'call-list';

  const card = buildReportCard(scoredCalls, {
    handle,
    headlineHorizonHours: Math.max(...horizonsHours),
  });

  return {
    ...card,
    linkedWallets: walletObjects.map((wallet) => ({ ...wallet, chain: 'solana', labels: [] })),
    sources: {
      callSource: 'local call list (no Frontrun key used)',
      priceData: 'GeckoTerminal public API (OHLCV, hourly, USD)',
      onchain: solana ? 'Solana JSON-RPC (read-only: getTokenAccountsByOwner)' : 'disabled',
    },
  };
}
