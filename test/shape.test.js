import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPath,
  selectArray,
  pickField,
  normaliseRecord,
  toUnixSeconds,
  toNumber,
  detectChain,
  normaliseChain,
} from '../src/lib/shape.js';

test('getPath reads nested values and never throws on missing branches', () => {
  assert.equal(getPath({ a: { b: { c: 7 } } }, 'a.b.c'), 7);
  assert.equal(getPath({ a: null }, 'a.b.c'), undefined);
  assert.equal(getPath(undefined, 'a'), undefined);
});

test('selectArray prefers the first configured path', () => {
  const payload = { data: { items: [1, 2], list: [1, 2, 3, 4] } };
  assert.deepEqual(selectArray(payload, ['data.items', 'data.list']), [1, 2]);
});

test('selectArray falls back to the largest array when no path matches', () => {
  const payload = { meta: { page: 1 }, result: { rows: [1, 2, 3], notes: ['a'] } };
  assert.deepEqual(selectArray(payload, ['data.items']), [1, 2, 3]);
});

test('selectArray returns an empty array when the payload holds none', () => {
  assert.deepEqual(selectArray({ ok: true }, ['data']), []);
  assert.deepEqual(selectArray(null, ['data']), []);
});

test('pickField matches candidate keys ignoring case and punctuation', () => {
  const record = { Smart_Followers: 42, contractAddress: 'abc' };
  assert.equal(pickField(record, ['smart_followers']), 42);
  assert.equal(pickField(record, ['smartFollowers']), 42);
  assert.equal(pickField(record, ['contract_address']), 'abc');
});

test('pickField skips empty values and returns undefined when nothing matches', () => {
  assert.equal(pickField({ a: '', b: null, c: 3 }, ['a', 'b', 'c']), 3);
  assert.equal(pickField({ a: 1 }, ['z']), undefined);
});

test('normaliseRecord maps a raw record and keeps the original', () => {
  const out = normaliseRecord({ ca: 'mint1', tweeted_at: 1_700_000_000 }, {
    contract: ['ca', 'contract'],
    calledAt: ['tweeted_at', 'created_at'],
  });
  assert.equal(out.contract, 'mint1');
  assert.equal(out.calledAt, 1_700_000_000);
  assert.equal(out._raw.ca, 'mint1');
});

test('toUnixSeconds accepts seconds, milliseconds, ISO strings and numeric strings', () => {
  assert.equal(toUnixSeconds(1_700_000_000), 1_700_000_000);
  assert.equal(toUnixSeconds(1_700_000_000_000), 1_700_000_000);
  assert.equal(toUnixSeconds('1700000000'), 1_700_000_000);
  assert.equal(toUnixSeconds('2023-11-14T22:13:20Z'), 1_700_000_000);
  assert.equal(toUnixSeconds(new Date('2023-11-14T22:13:20Z')), 1_700_000_000);
});

test('toUnixSeconds rejects nonsense instead of inventing a date', () => {
  assert.equal(toUnixSeconds(null), null);
  assert.equal(toUnixSeconds(''), null);
  assert.equal(toUnixSeconds('not a date'), null);
  assert.equal(toUnixSeconds(-5), null);
  assert.equal(toUnixSeconds(12345), null, 'implausibly small numbers are not timestamps');
});

test('toNumber parses formatted numbers and rejects junk', () => {
  assert.equal(toNumber('1,234.5'), 1234.5);
  assert.equal(toNumber('$42'), 42);
  assert.equal(toNumber('12%'), 12);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(undefined), null);
});

test('detectChain separates base58 Solana mints from EVM addresses', () => {
  assert.equal(detectChain('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), 'solana');
  assert.equal(detectChain('0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'), 'bsc');
  assert.equal(detectChain('nope'), null);
});

test('normaliseChain understands the aliases an API might return', () => {
  assert.equal(normaliseChain('SOL'), 'solana');
  assert.equal(normaliseChain('BNB'), 'bsc');
  assert.equal(normaliseChain(56), 'bsc');
  assert.equal(normaliseChain('mystery', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'), 'bsc');
});
