#!/usr/bin/env node
/**
 * Called It - CLI.
 *
 *   called-it doctor                       probe every configured Frontrun endpoint
 *   called-it report <handle> [flags]      build a KOL report card
 *   called-it backtest <handle> [flags]    report card + paper backtest
 *   called-it trending [--limit 25]        Frontrun trending accounts
 *   called-it wallet <address>             labels for one wallet
 *   called-it serve [--port 8788]          serve the reports in out/
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDotEnv, loadConfig, ConfigError, maskKey, PROJECT_ROOT } from './lib/env.js';
import { FrontrunClient, loadEndpointConfig } from './frontrun/client.js';
import { buildKolReport, buildListReport } from './pipeline.js';
import { parseCallList } from './lib/callList.js';
import { runPaperBacktest, DEFAULT_BACKTEST } from './score/paperBacktest.js';
import { renderReportCard, renderBacktest, rule } from './report/text.js';
import { renderHtml } from './report/html.js';
import { startServer } from './server.js';

const OUT_DIR = resolve(PROJECT_ROOT, 'out');

/**
 * @param {string[]} argv
 * @returns {{command:string, positional:string[], flags:Record<string,string|boolean>}}
 */
export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const positional = [];
  /** @type {Record<string,string|boolean>} */
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const [name, inlineValue] = token.slice(2).split('=');
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
      } else if (rest[index + 1] && !rest[index + 1].startsWith('--')) {
        flags[name] = rest[index + 1];
        index += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeClient(config) {
  return new FrontrunClient(config.frontrun, { config: loadEndpointConfig() });
}

/** Headline horizon plus the two fixed short ones, deduped and ascending. */
function horizons(headlineHours) {
  return [1, 6, headlineHours]
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a - b);
}

/** `--wallet A --wallet B` or `--wallet A,B`. */
function parseWallets(flag) {
  const raw = Array.isArray(flag) ? flag : [flag];
  return raw
    .filter((value) => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function backtestFor(card, flags) {
  return runPaperBacktest(card.calls, {
    bankrollUsd: num(flags.bankroll, DEFAULT_BACKTEST.bankrollUsd),
    positionUsd: num(flags.position, DEFAULT_BACKTEST.positionUsd),
    feeBps: num(flags['fee-bps'], DEFAULT_BACKTEST.feeBps),
    slippageBps: num(flags['slippage-bps'], DEFAULT_BACKTEST.slippageBps),
    exitHorizonHours: card.headlineHorizonHours,
  });
}

/** Print the card, then always write the HTML + JSON artefacts to out/. */
function emitReport(card, backtest, asJson) {
  if (asJson) {
    console.log(JSON.stringify({ card, backtest }, null, 2));
  } else {
    console.log('');
    console.log(renderReportCard(card));
    if (backtest) console.log(renderBacktest(backtest));
  }

  const slug = slugify(card.handle);
  const htmlPath = writeOut(`${slug}.html`, renderHtml(card, backtest));
  const jsonPath = writeOut(`${slug}.json`, JSON.stringify({ card, backtest }, null, 2));
  if (!asJson) {
    console.log(`report written to ${htmlPath}`);
    console.log(`raw json        ${jsonPath}`);
    console.log(`view it with    node src/cli.js serve`);
  }
}

/** Filenames come from user input, so keep them boring and traversal-free. */
export function slugify(value) {
  const cleaned = String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? 'report' : cleaned.slice(0, 64);
}

function writeOut(name, contents) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

const HELP = `
Called It - score what Crypto Twitter called, against what actually happened.

  npm run doctor                                probe every Frontrun endpoint with your key
  node src/cli.js report <handle> [flags]       build a report card
  node src/cli.js backtest <handle> [flags]     report card + paper backtest
  node src/cli.js score-list <file> [flags]     score a call list you already have (no key)
  node src/cli.js trending [--limit 25]         Frontrun trending accounts
  node src/cli.js wallet <address>              Frontrun labels for a wallet
  node src/cli.js serve [--port 8788]           serve generated reports

flags
  --max-calls N        calls to score            (default 40)
  --horizon H          headline horizon, hours   (default 24)
  --entry-delay M      entry delay, minutes      (default 5)
  --no-wallets         skip the on-chain holdings check
  --json               print machine-readable JSON
  --label NAME         report title for score-list
  --wallet ADDR        wallet to holdings-check   (score-list, repeatable via commas)
  --backtest           add the paper backtest     (score-list)
  --bankroll N         paper bankroll USD        (default ${DEFAULT_BACKTEST.bankrollUsd})
  --position N         paper size per call USD   (default ${DEFAULT_BACKTEST.positionUsd})
  --fee-bps N          per-side fee              (default ${DEFAULT_BACKTEST.feeBps})
  --slippage-bps N     per-side slippage         (default ${DEFAULT_BACKTEST.slippageBps})

Paper trading only. This tool contains no order-placing code. Not financial advice.
`;

async function main() {
  loadDotEnv();
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const asJson = Boolean(flags.json);

  if (command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'serve') {
    const config = loadConfig(process.env, { requireApiKey: false });
    const port = num(flags.port, config.port);
    if (!existsSync(OUT_DIR)) {
      console.error('out/ is empty - run a report first, e.g. node src/cli.js report <handle>');
      process.exitCode = 1;
      return;
    }
    await startServer({ port, dir: OUT_DIR });
    return;
  }

  if (command === 'score-list') {
    const file = positional[0];
    if (!file) throw new ConfigError('usage: node src/cli.js score-list <file.json|.jsonl|.csv>');
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) throw new ConfigError(`call list not found: ${path}`);

    // No API key needed: the list supplies the calls, GeckoTerminal supplies the prices.
    const config = loadConfig(process.env, { requireApiKey: false });
    const { calls, rejected } = parseCallList(readFileSync(path, 'utf8'), {
      defaultHandle: typeof flags.label === 'string' ? flags.label : null,
    });

    if (!asJson) {
      console.error(`  · call list: ${calls.length} usable, ${rejected.length} rejected`);
      for (const entry of rejected) console.error(`  · rejected row ${entry.row}: ${entry.reason}`);
    }

    const horizon = num(flags.horizon, 24);
    const card = await buildListReport(calls.slice(0, num(flags['max-calls'], 40)), {
      label: typeof flags.label === 'string' ? flags.label : undefined,
      horizonsHours: horizons(horizon),
      entryDelayMinutes: num(flags['entry-delay'], 5),
      wallets: parseWallets(flags.wallet),
      solanaRpcUrl: config.solanaRpcUrl,
      geckoTerminalBaseUrl: config.geckoTerminalBaseUrl,
      log: asJson ? () => {} : (message) => console.error(`  · ${message}`),
    });

    emitReport(card, flags.backtest ? backtestFor(card, flags) : null, asJson);
    return;
  }

  const config = loadConfig(process.env);
  const client = makeClient(config);

  switch (command) {
    case 'doctor': {
      console.log(rule('CALLED IT - doctor'));
      console.log(`base url     ${config.frontrun.baseUrl}`);
      console.log(`auth header  ${config.frontrun.authHeader}${config.frontrun.authPrefix ? ` (prefix "${config.frontrun.authPrefix}")` : ''}`);
      console.log(`api key      ${maskKey(config.frontrun.apiKey)}`);
      console.log(`throttle     ${config.frontrun.maxRpm} req/min`);
      console.log('');
      const handle = positional[0] ?? 'frontrunpro';
      const address = positional[1] ?? 'So11111111111111111111111111111111111111112';
      const results = await client.healthCheck({ handle, address, chain: 'solana', limit: 5, period: '7d' });
      for (const result of results) {
        const status = result.ok ? `OK   ${result.status} · ${result.items} items` : `FAIL ${result.status || '-'} · ${result.error}`;
        console.log(`[${result.kind.padEnd(6)}] ${result.endpoint.padEnd(18)} ${status}`);
        console.log(`           ${result.url}`);
        if (result.sampleKeys?.length) console.log(`           keys: ${result.sampleKeys.join(', ')}`);
      }
      console.log('');
      const failed = results.filter((result) => !result.ok);
      if (failed.length > 0) {
        console.log(
          `${failed.length}/${results.length} endpoints did not answer. Fix the path or query in\n` +
            '  config/frontrun.endpoints.json\n' +
            'to match the hackathon API docs, then re-run doctor. No code changes needed.',
        );
        process.exitCode = 1;
      } else {
        console.log('All endpoints answered. You are ready to run a report.');
      }
      return;
    }

    case 'trending': {
      const result = await client.trendingAccounts({ limit: num(flags.limit, 25) });
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(rule('Frontrun trending accounts'));
      for (const item of result.items) {
        console.log(`  @${String(item.handle ?? '?').padEnd(18)} smart followers ${item.smartFollowers ?? '—'}`);
      }
      return;
    }

    case 'wallet': {
      const address = positional[0];
      if (!address) throw new ConfigError('usage: node src/cli.js wallet <address>');
      const labels = await client.walletLabels(address, { chain: String(flags.chain ?? 'solana') });
      if (asJson) {
        console.log(JSON.stringify(labels, null, 2));
        return;
      }
      console.log(rule(`Frontrun labels for ${address}`));
      if (labels.items.length === 0) console.log('  (none returned)');
      for (const label of labels.items) console.log(`  ${label.label ?? '?'}  [${label.category ?? '-'}]`);
      return;
    }

    case 'report':
    case 'backtest': {
      const handle = positional[0];
      if (!handle) throw new ConfigError(`usage: node src/cli.js ${command} <handle>`);

      const horizon = num(flags.horizon, 24);
      const card = await buildKolReport(client, handle, {
        maxCalls: num(flags['max-calls'], 40),
        horizonsHours: horizons(horizon),
        entryDelayMinutes: num(flags['entry-delay'], 5),
        checkWallets: !flags['no-wallets'],
        solanaRpcUrl: config.solanaRpcUrl,
        geckoTerminalBaseUrl: config.geckoTerminalBaseUrl,
        log: asJson ? () => {} : (message) => console.error(`  · ${message}`),
      });

      emitReport(card, command === 'backtest' ? backtestFor(card, flags) : null, asJson);
      return;
    }

    default:
      process.stdout.write(HELP);
      process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(`\nfailed: ${error.message}`);
    if (process.env.DEBUG) console.error(error.stack);
  }
  process.exitCode = 1;
});
