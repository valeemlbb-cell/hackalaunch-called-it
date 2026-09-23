#!/usr/bin/env node
/**
 * MCP stdio server so Claude (or any MCP client) can ask for a report card in
 * plain language. Hand-rolled JSON-RPC over stdio - no dependencies, which
 * keeps the supply chain of a tool that holds an API key as small as possible.
 *
 * Tools exposed (all read-only):
 *   kol_report_card   - score every contract a handle called
 *   frontrun_trending - trending accounts by smart-follower attention
 *   wallet_xray       - Frontrun labels + linked handle for one wallet
 *
 * There is no tool that places an order. There is no tool that returns the key.
 */

import { loadDotEnv, loadConfig } from '../lib/env.js';
import { FrontrunClient, loadEndpointConfig } from '../frontrun/client.js';
import { buildKolReport } from '../pipeline.js';
import { runPaperBacktest } from '../score/paperBacktest.js';

const PROTOCOL_VERSION = '2024-11-05';

export const TOOLS = [
  {
    name: 'kol_report_card',
    description:
      'Score every contract address a Crypto Twitter handle has called, using the Frontrun Data API for the calls ' +
      'and real historical price data for what happened after. Returns hit rate, median return, per-call detail and ' +
      'an optional paper-trading backtest. Read-only; places no trades.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'X/Twitter handle, with or without @' },
        maxCalls: { type: 'number', description: 'How many recent calls to score (default 20)' },
        horizonHours: { type: 'number', description: 'Headline horizon in hours (default 24)' },
        backtest: { type: 'boolean', description: 'Also run the paper backtest (default false)' },
      },
      required: ['handle'],
    },
  },
  {
    name: 'frontrun_trending',
    description: 'Twitter accounts currently gaining the most smart-follower attention, from the Frontrun Data API.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many accounts (default 20)' } },
    },
  },
  {
    name: 'wallet_xray',
    description: 'Frontrun classification labels for a wallet address.',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string' },
        chain: { type: 'string', enum: ['solana', 'bsc'], description: 'default solana' },
      },
      required: ['address'],
    },
  },
];

/**
 * Pure dispatch, so it can be unit tested without stdio.
 * @param {{name:string, arguments?:Record<string,any>}} request
 * @param {{client:FrontrunClient, config:any}} context
 */
export async function callTool(request, context) {
  const args = request.arguments ?? {};
  switch (request.name) {
    case 'kol_report_card': {
      const horizon = Number(args.horizonHours) || 24;
      const card = await buildKolReport(context.client, String(args.handle), {
        maxCalls: Number(args.maxCalls) || 20,
        horizonsHours: [1, 6, horizon].filter((value, index, all) => all.indexOf(value) === index).sort((a, b) => a - b),
        solanaRpcUrl: context.config.solanaRpcUrl,
        geckoTerminalBaseUrl: context.config.geckoTerminalBaseUrl,
      });
      const backtest = args.backtest ? runPaperBacktest(card.calls, { exitHorizonHours: card.headlineHorizonHours }) : null;
      return {
        handle: card.handle,
        grade: card.grade,
        hitRatePct: card.hitRatePct,
        medianReturnPct: card.medianReturnPct,
        medianMaxGainPct: card.medianMaxGainPct,
        confidence: card.confidence,
        totals: card.totals,
        talkVsTradeFlags: card.talkVsTradeFlags,
        calls: card.calls.map((entry) => ({
          contract: entry.call.contract,
          symbol: entry.call.symbol,
          calledAt: entry.call.calledAt,
          tweetUrl: entry.call.tweetUrl,
          scored: entry.score.scored,
          reason: entry.score.reason ?? null,
          returnPct: entry.score.horizons?.[`h${card.headlineHorizonHours}`]?.returnPct ?? null,
          maxGainPct: entry.score.horizons?.[`h${card.headlineHorizonHours}`]?.maxGainPct ?? null,
          linkedWalletHoldsNow: entry.walletCheck?.holdsNow ?? null,
        })),
        backtest: backtest && {
          mode: 'paper',
          returnPct: backtest.returnPct,
          winRatePct: backtest.winRatePct,
          tradeCount: backtest.tradeCount,
          note: 'Simulation only. No orders were placed. Not financial advice.',
        },
        frontrunEndpointsUsed: context.client.callLog.map((entry) => entry.endpoint),
      };
    }

    case 'frontrun_trending': {
      const result = await context.client.trendingAccounts({ limit: Number(args.limit) || 20 });
      return { accounts: result.items, endpoint: 'trendingAccounts' };
    }

    case 'wallet_xray': {
      const result = await context.client.walletLabels(String(args.address), { chain: String(args.chain ?? 'solana') });
      return { address: args.address, labels: result.items, endpoint: 'walletLabels' };
    }

    default:
      throw new Error(`unknown tool: ${request.name}`);
  }
}

/**
 * @param {any} message
 * @param {{client:FrontrunClient, config:any}} context
 */
export async function handleMessage(message, context) {
  const { id, method, params } = message ?? {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'called-it', version: '1.0.0' },
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const result = await callTool(params, context);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (error) {
        return reply({ content: [{ type: 'text', text: `error: ${error.message}` }], isError: true });
      }
    case 'ping':
      return reply({});
    default:
      if (id === undefined) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

/* c8 ignore start - stdio wiring, exercised manually */
async function main() {
  loadDotEnv();
  const config = loadConfig(process.env);
  const client = new FrontrunClient(config.frontrun, { config: loadEndpointConfig() });
  const context = { client, config };

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const response = await handleMessage(message, context);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  });
  process.stderr.write('called-it MCP server ready on stdio\n');
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mcp/server.js')) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
/* c8 ignore stop */
