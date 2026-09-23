/**
 * Safety tests. These encode the hackathon's disqualification rules as
 * assertions so a careless future edit fails the build instead of the vote.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { PROJECT_ROOT } from '../src/lib/env.js';
import { SolanaReader, READ_ONLY_METHODS } from '../src/onchain/solana.js';
import { safeResolve } from '../src/server.js';
import { escapeHtml, renderHtml } from '../src/report/html.js';

/** @param {string} dir */
function sourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (['.js', '.json', '.md'].includes(extname(name))) acc.push(full);
  }
  return acc;
}

test('no source file mentions a seed phrase, private key or wallet signing API', () => {
  const banned = [/seed\s*phrase/i, /mnemonic/i, /secretKey/i, /Keypair\.from/i, /signTransaction/i, /sendTransaction/i];
  const offenders = [];
  for (const file of sourceFiles(resolve(PROJECT_ROOT, 'src'))) {
    const contents = readFileSync(file, 'utf8');
    for (const pattern of banned) {
      // The README-style prose "never asks for a seed phrase" is allowed; code is not.
      const matches = contents.match(pattern);
      if (matches && !/never|no |without/i.test(lineOf(contents, matches.index))) {
        offenders.push(`${file}: ${matches[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'wallet-signing surface must not exist in this repo');
});

function lineOf(contents, index) {
  const start = contents.lastIndexOf('\n', index) + 1;
  const end = contents.indexOf('\n', index);
  return contents.slice(start, end === -1 ? undefined : end);
}

test('no committed file contains a plausible API key value', () => {
  const files = sourceFiles(PROJECT_ROOT).filter((file) => !file.includes('node_modules') && !file.includes(`${'out'}${'/'}`));
  const suspicious = /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i;
  const offenders = files.filter((file) => {
    const contents = readFileSync(file, 'utf8');
    return suspicious.test(contents) && !file.endsWith('safety.test.js');
  });
  assert.deepEqual(offenders, []);
});

test('the demo recorder burns in no proprietary or system font', () => {
  const recorder = readFileSync(resolve(PROJECT_ROOT, 'scripts', 'record-demo.mjs'), 'utf8');
  assert.doesNotMatch(
    recorder,
    /[A-Za-z]:[\\/]Windows[\\/]Fonts|\/Library\/Fonts|\/usr\/share\/fonts/i,
    'the published video must not embed a font from the machine that rendered it',
  );
  for (const font of ['DejaVuSansMono.ttf', 'DejaVuSans-Bold.ttf', 'LICENSE-DejaVu.txt']) {
    const path = resolve(PROJECT_ROOT, 'assets', 'fonts', font);
    assert.ok(statSync(path).size > 0, `assets/fonts/${font} must be committed with the repo`);
  }
});

test('the committed receipts are never read by the shipped code', () => {
  const files = sourceFiles(resolve(PROJECT_ROOT, 'src'));
  const offenders = files.filter((file) => /receipts?[\\/]/i.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], 'examples/receipts is captured output, not a fixture');
});

test('.env.example ships no values', () => {
  const contents = readFileSync(resolve(PROJECT_ROOT, '.env.example'), 'utf8');
  const filled = contents
    .split('\n')
    .filter((line) => /^(FRONTRUN_API_KEY)\s*=\s*\S/.test(line.trim()));
  assert.deepEqual(filled, [], '.env.example must never carry a real key');
});

test('.gitignore excludes .env', () => {
  const contents = readFileSync(resolve(PROJECT_ROOT, '.gitignore'), 'utf8');
  assert.match(contents, /^\.env$/m);
});

test('the Solana reader rejects any non-read RPC method', async () => {
  const reader = new SolanaReader({ rpcUrl: 'https://rpc.invalid' }, { fetchImpl: async () => {
    throw new Error('network should never be touched for a banned method');
  } });
  await assert.rejects(() => reader.rpc('sendTransaction', []), /refusing to call non-read/);
  await assert.rejects(() => reader.rpc('requestAirdrop', []), /refusing to call non-read/);
  assert.ok(!READ_ONLY_METHODS.has('sendTransaction'));
});

test('the report server refuses to serve files outside its directory', () => {
  const dir = resolve(PROJECT_ROOT, 'out');
  assert.equal(safeResolve(dir, '/../../.env'), null);
  assert.equal(safeResolve(dir, '/..%2f..%2f.env'), null);
  assert.ok(safeResolve(dir, '/kol.html')?.endsWith('kol.html'));
});

test('html output escapes anything that came from an API', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const card = {
    handle: '<img src=x onerror=alert(1)>',
    generatedAt: 'now',
    headlineHorizonHours: 24,
    totals: { calls: 0, scored: 0, unscored: 0, decided: 0, hits: 0 },
    grade: 'N/A',
    confidence: 'low-sample',
    hitRatePct: null,
    medianReturnPct: null,
    medianMaxGainPct: null,
    medianMaxDrawdownPct: null,
    talkVsTradeFlags: [],
    linkedWallets: [],
    calls: [],
    sources: { frontrunCalls: [], priceData: 'x', onchain: 'y' },
  };
  const html = renderHtml(card);
  assert.ok(!html.includes('<img src=x onerror'), 'handle must be escaped');
  assert.match(html, /risk warning/i);
});

test('the rendered report always carries a risk warning and a paper-only label', () => {
  const card = {
    handle: 'kol',
    generatedAt: 'now',
    headlineHorizonHours: 24,
    totals: { calls: 1, scored: 1, unscored: 0, decided: 1, hits: 1 },
    grade: 'C',
    confidence: 'low-sample',
    hitRatePct: 100,
    medianReturnPct: 10,
    medianMaxGainPct: 20,
    medianMaxDrawdownPct: -5,
    talkVsTradeFlags: [],
    linkedWallets: [],
    calls: [],
    sources: { frontrunCalls: [], priceData: 'x', onchain: 'y' },
  };
  const html = renderHtml(card, {
    returnPct: 5,
    winRatePct: 100,
    tradeCount: 1,
    maxDrawdownPct: 0,
    equityCurve: [{ equity: 1000 }, { equity: 1050 }],
    settings: { positionUsd: 100, feeBps: 30, slippageBps: 100, exitHorizonHours: 24 },
  });
  assert.match(html, /simulation only/i);
  assert.match(html, /never connects a\s+wallet/i);
  assert.match(html, /not financial advice/i);
});
