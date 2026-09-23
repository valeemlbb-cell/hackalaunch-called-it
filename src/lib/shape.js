/**
 * Shape-tolerant helpers.
 *
 * The Frontrun API reference is gated, so the client never assumes an exact
 * response shape. These pure helpers turn "some JSON that probably contains a
 * list of calls" into a normalised record using the candidate keys declared in
 * config/frontrun.endpoints.json. Every function here is pure and unit tested.
 */

const MS_PER_SECOND = 1000;
/** Unix seconds beyond this are almost certainly milliseconds. Year 2286. */
const SECONDS_UPPER_BOUND = 10_000_000_000;
/** Timestamps before this are treated as bogus. 2001-09-09. */
const MIN_PLAUSIBLE_SECONDS = 1_000_000_000;

/**
 * Read a dotted path out of a plain object without throwing.
 * @param {unknown} source
 * @param {string} path dotted path, e.g. "data.items"
 * @returns {unknown} the value, or undefined
 */
export function getPath(source, path) {
  if (!path) return source;
  return path.split('.').reduce((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return acc[key];
  }, source);
}

/**
 * Walk a JSON value and return every array found, deepest-first is irrelevant -
 * we only care about the largest one. Used as the fallback when none of the
 * configured `select` paths match.
 * @param {unknown} value
 * @param {number} [maxDepth]
 * @returns {unknown[][]}
 */
function collectArrays(value, maxDepth = 6) {
  /** @type {unknown[][]} */
  const found = [];
  const visit = (node, depth) => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      found.push(node);
      return;
    }
    for (const child of Object.values(node)) visit(child, depth + 1);
  };
  visit(value, 0);
  return found;
}

/**
 * Pull the list of records out of an API response.
 * @param {unknown} payload parsed JSON body
 * @param {string[]} [selectPaths] candidate dotted paths, first match wins
 * @returns {unknown[]}
 */
export function selectArray(payload, selectPaths = []) {
  for (const path of selectPaths) {
    const candidate = getPath(payload, path);
    if (Array.isArray(candidate)) return candidate;
  }
  const arrays = collectArrays(payload);
  if (arrays.length === 0) return [];
  return arrays.reduce((best, current) => (current.length > best.length ? current : best), arrays[0]);
}

/**
 * First present, non-empty value among candidate keys.
 * Matching is case-insensitive and ignores underscores, so `smart_followers`,
 * `smartFollowers` and `SmartFollowers` all resolve from one candidate.
 * @param {Record<string, unknown>} record
 * @param {string[]} candidateKeys
 * @returns {unknown}
 */
export function pickField(record, candidateKeys = []) {
  if (!record || typeof record !== 'object') return undefined;
  /** @type {Map<string, unknown>} */
  const loose = new Map();
  for (const [key, value] of Object.entries(record)) {
    loose.set(normaliseKey(key), value);
  }
  for (const candidate of candidateKeys) {
    const direct = record[candidate];
    if (isPresent(direct)) return direct;
    const fuzzy = loose.get(normaliseKey(candidate));
    if (isPresent(fuzzy)) return fuzzy;
  }
  return undefined;
}

function normaliseKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Apply a whole fieldMap to one raw record.
 * @param {Record<string, unknown>} record
 * @param {Record<string, string[]>} fieldMap
 * @returns {Record<string, unknown>} normalised record plus `_raw`
 */
export function normaliseRecord(record, fieldMap) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [field, candidates] of Object.entries(fieldMap ?? {})) {
    const value = pickField(record, candidates);
    if (value !== undefined) out[field] = value;
  }
  out._raw = record;
  return out;
}

/**
 * Coerce whatever a timestamp field contains into unix seconds.
 * Accepts unix seconds, unix milliseconds, ISO-8601 strings and numeric strings.
 * @param {unknown} value
 * @returns {number|null} unix seconds, or null when unparseable
 */
export function toUnixSeconds(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return fromNumber(value);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return fromNumber(Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return Math.floor(parsed / MS_PER_SECOND);
    return null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / MS_PER_SECOND) : null;
  }

  return null;
}

function fromNumber(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const seconds = raw >= SECONDS_UPPER_BOUND ? Math.floor(raw / MS_PER_SECOND) : Math.floor(raw);
  return seconds >= MIN_PLAUSIBLE_SECONDS ? seconds : null;
}

/**
 * Coerce a numeric-ish field (the API may return "1.23" or 1.23).
 * @param {unknown} value
 * @returns {number|null}
 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '');
    if (cleaned === '' || !/^-?\d*\.?\d+([eE][-+]?\d+)?%?$/.test(cleaned)) return null;
    const parsed = Number(cleaned.replace('%', ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Base58 alphabet, no 0/O/I/l. */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Classify a contract/wallet address so we know which chain helper to use.
 * @param {unknown} address
 * @returns {'solana'|'bsc'|null}
 */
export function detectChain(address) {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (EVM_RE.test(trimmed)) return 'bsc';
  if (BASE58_RE.test(trimmed)) return 'solana';
  return null;
}

/**
 * Normalise a chain hint from the API ("SOL", "solana", 101, "bnb") to our slug.
 * Falls back to address-shape detection.
 * @param {unknown} hint
 * @param {unknown} [address]
 * @returns {'solana'|'bsc'|null}
 */
export function normaliseChain(hint, address) {
  const raw = String(hint ?? '').trim().toLowerCase();
  if (['sol', 'solana', '101', 'sol-mainnet', 'solana-mainnet'].includes(raw)) return 'solana';
  if (['bsc', 'bnb', 'bnb-chain', 'binance', 'bep20', '56'].includes(raw)) return 'bsc';
  return detectChain(address);
}
