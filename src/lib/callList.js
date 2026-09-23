/**
 * Parse a hand-written call list.
 *
 * Frontrun's `caHistory` is the normal source of calls, but it is Gold-gated.
 * A call list lets you score calls you already have — from a spreadsheet, from
 * a Telegram export, from your own notes — through exactly the same engine.
 *
 * This is NOT a mock mode. Nothing here invents a price, a candle or a return:
 * it only supplies the (contract, calledAt) pairs that Frontrun would have
 * supplied. Every number downstream still comes from real GeckoTerminal candles,
 * and a row the parser cannot vouch for is rejected, never guessed.
 *
 * Accepted shapes:
 *   - JSON array of objects
 *   - JSON object with an `items` or `calls` array
 *   - JSONL (one object per line)
 *   - CSV with a header row
 *
 * Required per row: `contract` and `calledAt`.
 * Optional: `chain` (inferred from the address shape), `symbol`, `tweetUrl`, `handle`.
 */

import { toUnixSeconds, normaliseChain } from './shape.js';
import { ConfigError } from './env.js';

/** Rows above this are almost certainly a pasted file, not a call list. */
export const MAX_ROWS = 500;

/**
 * @typedef {{
 *   handle: string|null, contract: string, chain: 'solana'|'bsc',
 *   symbol: string|null, calledAt: number, tweetUrl: string|null, source: 'call-list'
 * }} ListedCall
 */

/**
 * @typedef {{calls: ListedCall[], rejected: Array<{row:number, reason:string}>}} ParsedCallList
 */

/**
 * @param {string} contents raw file body
 * @param {{defaultHandle?: string|null}} [options]
 * @returns {ParsedCallList}
 */
export function parseCallList(contents, options = {}) {
  const rows = toRows(contents);
  if (rows.length === 0) throw new ConfigError('call list is empty - expected JSON, JSONL or CSV rows');
  if (rows.length > MAX_ROWS) {
    throw new ConfigError(`call list has ${rows.length} rows, refusing more than ${MAX_ROWS}`);
  }

  const calls = [];
  const rejected = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    const result = normaliseRow(row, options.defaultHandle ?? null);
    if (result.error) {
      rejected.push({ row: index + 1, reason: result.error });
      return;
    }
    const key = `${result.call.chain}:${result.call.contract}:${result.call.calledAt}`;
    if (seen.has(key)) {
      rejected.push({ row: index + 1, reason: 'duplicate-call' });
      return;
    }
    seen.add(key);
    calls.push(result.call);
  });

  if (calls.length === 0) {
    const why = rejected.map((entry) => `row ${entry.row}: ${entry.reason}`).join('; ');
    throw new ConfigError(`no usable calls in the list (${why})`);
  }

  return {
    calls: calls.sort((a, b) => b.calledAt - a.calledAt),
    rejected,
  };
}

/**
 * Turn one raw row into a scored-ready call, or say why it cannot be.
 * @param {Record<string, unknown>} row
 * @param {string|null} defaultHandle
 * @returns {{call: ListedCall, error?: undefined} | {call?: undefined, error: string}}
 */
function normaliseRow(row, defaultHandle) {
  if (!row || typeof row !== 'object') return { error: 'not-an-object' };

  const contract = typeof row.contract === 'string' ? row.contract.trim() : '';
  if (!contract) return { error: 'missing-contract' };

  const chain = normaliseChain(row.chain, contract);
  if (!chain) return { error: 'unrecognised-contract-address' };

  const calledAt = toUnixSeconds(row.calledAt);
  if (!calledAt) return { error: 'missing-or-unparseable-calledAt' };
  if (calledAt > Math.floor(Date.now() / 1000) + 60) return { error: 'calledAt-is-in-the-future' };

  return {
    call: {
      handle: str(row.handle) ?? defaultHandle,
      contract,
      chain,
      symbol: str(row.symbol),
      calledAt,
      tweetUrl: str(row.tweetUrl),
      source: 'call-list',
    },
  };
}

function str(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Detect the container format and return plain row objects.
 * @param {string} contents
 * @returns {Array<Record<string, unknown>>}
 */
function toRows(contents) {
  const text = String(contents).replace(/^﻿/, '').trim();
  if (text === '') return [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

  // JSONL first: a multi-line file whose every line is its own JSON object would
  // otherwise be handed to the whole-document parser and rejected.
  if (lines.length > 1 && lines.every((line) => line.trim().startsWith('{'))) {
    const rows = lines.map((line) => tryJson(line));
    if (rows.every((row) => row !== undefined)) return rows;
  }

  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = parseJson(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
    if (Array.isArray(parsed?.calls)) return parsed.calls;
    throw new ConfigError('JSON call list must be an array, or an object with an "items" or "calls" array');
  }

  return parseCsv(lines);
}

/** Parse one line, or undefined when it is not JSON. */
function tryJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`call list is not valid JSON: ${error.message}`);
  }
}

/**
 * Minimal CSV: comma separated, optional double quotes, no embedded newlines.
 * @param {string[]} lines
 */
function parseCsv(lines) {
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim());
  if (!header.includes('contract')) {
    throw new ConfigError('CSV call list needs a header row containing at least "contract" and "calledAt"');
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    /** @type {Record<string, unknown>} */
    const row = {};
    header.forEach((name, index) => {
      row[name] = cells[index] ?? '';
    });
    return row;
  });
}

/** @param {string} line */
export function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}
