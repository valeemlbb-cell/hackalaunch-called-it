/**
 * GeckoTerminal public API - real historical OHLCV for the "what actually
 * happened" half of a report card. No API key, no account, read-only.
 *
 * Public-tier limits worth knowing:
 *  - ~30 requests/minute (we throttle to 25)
 *  - OHLCV only reaches back 180 days
 *  - max 1000 candles per request
 */

import { RateLimiter, getJson } from '../lib/http.js';

const NETWORK_SLUG = { solana: 'solana', bsc: 'bsc' };
const PUBLIC_RPM = 25;
const MAX_CANDLES = 1000;
export const OHLCV_HISTORY_DAYS = 180;

export class GeckoTerminalClient {
  /**
   * @param {{baseUrl?:string}} [options]
   * @param {{fetchImpl?:typeof fetch}} [deps]
   */
  constructor(options = {}, deps = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://api.geckoterminal.com/api/v2').replace(/\/+$/, '');
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.limiter = new RateLimiter(PUBLIC_RPM);
    /** @type {Map<string, Promise<any>>} */
    this.poolCache = new Map();
  }

  /** @param {string} path @param {Record<string,string|number>} [query] */
  async get(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return this.limiter.schedule(() =>
      getJson(url.toString(), { fetchImpl: this.fetchImpl, retries: 2, timeoutMs: 20_000 }),
    );
  }

  /**
   * Most liquid pool for a token, which is the one we price against.
   * @param {'solana'|'bsc'} chain
   * @param {string} contract
   * @returns {Promise<{poolAddress:string, name:string, quoteSymbol:string, liquidityUsd:number, createdAt:string|null}|null>}
   */
  async topPool(chain, contract) {
    const network = NETWORK_SLUG[chain];
    if (!network) return null;
    const cacheKey = `${network}:${contract}`;
    if (!this.poolCache.has(cacheKey)) {
      this.poolCache.set(cacheKey, this.#fetchTopPool(network, contract));
    }
    return this.poolCache.get(cacheKey);
  }

  async #fetchTopPool(network, contract) {
    let response;
    try {
      response = await this.get(`/networks/${network}/tokens/${encodeURIComponent(contract)}/pools`, { page: 1 });
    } catch {
      return null;
    }
    const pools = Array.isArray(response.body?.data) ? response.body.data : [];
    if (pools.length === 0) return null;

    const ranked = pools
      .map((pool) => ({
        poolAddress: pool?.attributes?.address ?? null,
        name: pool?.attributes?.name ?? '',
        liquidityUsd: Number(pool?.attributes?.reserve_in_usd ?? 0),
        createdAt: pool?.attributes?.pool_created_at ?? null,
      }))
      .filter((pool) => pool.poolAddress)
      .sort((a, b) => b.liquidityUsd - a.liquidityUsd);

    if (ranked.length === 0) return null;
    const best = ranked[0];
    return { ...best, quoteSymbol: best.name.split('/').pop()?.trim() ?? '' };
  }

  /**
   * Candles for a pool, oldest first, priced in USD against the base token.
   * @param {'solana'|'bsc'} chain
   * @param {string} poolAddress
   * @param {{timeframe?:'minute'|'hour'|'day', aggregate?:number, limit?:number, beforeTimestamp?:number}} [options]
   * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>>}
   */
  async candles(chain, poolAddress, options = {}) {
    const network = NETWORK_SLUG[chain];
    if (!network) return [];
    const { timeframe = 'hour', aggregate = 1, limit = 200, beforeTimestamp } = options;

    const response = await this.get(`/networks/${network}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}`, {
      aggregate,
      limit: Math.min(limit, MAX_CANDLES),
      currency: 'usd',
      token: 'base',
      ...(beforeTimestamp ? { before_timestamp: beforeTimestamp } : {}),
    });

    const list = response.body?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];
    return list
      .map((row) => ({
        t: Number(row[0]),
        o: Number(row[1]),
        h: Number(row[2]),
        l: Number(row[3]),
        c: Number(row[4]),
        v: Number(row[5]),
      }))
      .filter((candle) => Number.isFinite(candle.t) && Number.isFinite(candle.c) && candle.c > 0)
      .sort((a, b) => a.t - b.t);
  }
}

/**
 * True when a call is old enough that the public OHLCV window cannot cover it.
 * @param {number} calledAtSeconds
 * @param {number} [nowSeconds]
 */
export function isBeyondHistoryWindow(calledAtSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  return nowSeconds - calledAtSeconds > OHLCV_HISTORY_DAYS * 86_400;
}
