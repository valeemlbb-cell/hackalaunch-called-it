import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCallList, splitCsvLine, MAX_ROWS } from '../src/lib/callList.js';
import { ConfigError } from '../src/lib/env.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x' + 'a'.repeat(40);
const RECENT = '2026-09-01T00:00:00Z';

test('parses a JSON array and infers the chain from the address shape', () => {
  // Arrange
  const body = JSON.stringify([
    { contract: SOL_MINT, calledAt: RECENT, symbol: 'SOL' },
    { contract: EVM, calledAt: RECENT },
  ]);

  // Act
  const { calls, rejected } = parseCallList(body);

  // Assert
  assert.equal(rejected.length, 0);
  assert.deepEqual(
    calls.map((call) => call.chain).sort(),
    ['bsc', 'solana'],
  );
  assert.equal(calls.every((call) => call.source === 'call-list'), true);
});

test('accepts an object wrapper with an items array', () => {
  const body = JSON.stringify({ items: [{ contract: SOL_MINT, calledAt: RECENT }] });
  assert.equal(parseCallList(body).calls.length, 1);
});

test('parses JSONL', () => {
  const body = [
    JSON.stringify({ contract: SOL_MINT, calledAt: RECENT }),
    JSON.stringify({ contract: BONK_MINT, calledAt: RECENT }),
  ].join('\n');
  assert.equal(parseCallList(body).calls.length, 2);
});

test('parses CSV with a header row and quoted cells', () => {
  // Arrange
  const body = ['contract,calledAt,symbol', `${SOL_MINT},${RECENT},"WRAPPED, SOL"`].join('\n');

  // Act
  const { calls } = parseCallList(body);

  // Assert
  assert.equal(calls.length, 1);
  assert.equal(calls[0].symbol, 'WRAPPED, SOL');
});

test('rejects rows instead of guessing at them, and says which', () => {
  // Arrange
  const body = JSON.stringify([
    { contract: SOL_MINT, calledAt: RECENT },
    { calledAt: RECENT },
    { contract: 'not-an-address', calledAt: RECENT },
    { contract: BONK_MINT },
  ]);

  // Act
  const { calls, rejected } = parseCallList(body);

  // Assert
  assert.equal(calls.length, 1);
  assert.deepEqual(
    rejected.map((entry) => entry.reason),
    ['missing-contract', 'unrecognised-contract-address', 'missing-or-unparseable-calledAt'],
  );
});

test('rejects a call dated in the future rather than scoring it', () => {
  const body = JSON.stringify([
    { contract: SOL_MINT, calledAt: RECENT },
    { contract: BONK_MINT, calledAt: new Date(Date.now() + 86_400_000).toISOString() },
  ]);
  const { rejected } = parseCallList(body);
  assert.equal(rejected[0].reason, 'calledAt-is-in-the-future');
});

test('drops duplicate calls', () => {
  const row = { contract: SOL_MINT, calledAt: RECENT };
  const { calls, rejected } = parseCallList(JSON.stringify([row, row]));
  assert.equal(calls.length, 1);
  assert.equal(rejected[0].reason, 'duplicate-call');
});

test('sorts newest call first', () => {
  const body = JSON.stringify([
    { contract: SOL_MINT, calledAt: '2026-01-01T00:00:00Z' },
    { contract: BONK_MINT, calledAt: '2026-06-01T00:00:00Z' },
  ]);
  const { calls } = parseCallList(body);
  assert.equal(calls[0].contract, BONK_MINT);
});

test('applies the default handle only when the row has none', () => {
  const body = JSON.stringify([
    { contract: SOL_MINT, calledAt: RECENT },
    { contract: BONK_MINT, calledAt: RECENT, handle: 'someone' },
  ]);
  const { calls } = parseCallList(body, { defaultHandle: 'fallback' });
  const byContract = Object.fromEntries(calls.map((call) => [call.contract, call.handle]));
  assert.equal(byContract[SOL_MINT], 'fallback');
  assert.equal(byContract[BONK_MINT], 'someone');
});

test('throws when nothing in the list is usable', () => {
  assert.throws(() => parseCallList(JSON.stringify([{ contract: 'junk', calledAt: RECENT }])), ConfigError);
});

test('throws on an empty list and on invalid JSON', () => {
  assert.throws(() => parseCallList('   '), ConfigError);
  assert.throws(() => parseCallList('[{oops}]'), ConfigError);
});

test('refuses an absurdly long list instead of hammering the price API', () => {
  const rows = Array.from({ length: MAX_ROWS + 1 }, () => ({ contract: SOL_MINT, calledAt: RECENT }));
  assert.throws(() => parseCallList(JSON.stringify(rows)), /refusing more than/);
});

test('splitCsvLine handles quotes, escaped quotes and empty cells', () => {
  assert.deepEqual(splitCsvLine('a,"b,c",,"say ""hi"""'), ['a', 'b,c', '', 'say "hi"']);
});
