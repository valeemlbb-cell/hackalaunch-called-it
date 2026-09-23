/**
 * Frontrun Data API client.
 *
 * Every endpoint path, query parameter and response field name comes from
 * config/frontrun.endpoints.json - nothing about the wire format is baked into
 * this file. That matters because the API reference is Gold/hackathon gated:
 * when the real docs land you edit one JSON file, not the client.
 *
 * Hard rule enforced here: the client has no offline, mock or sample mode.
 * If the API is unreachable or unauthorised, calls throw. The tool would
 * rather show nothing than show data it did not receive from Frontrun.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT } from '../lib/env.js';
import { RateLimiter, getJson, HttpError, redact } from '../lib/http.js';
import { selectArray, normaliseRecord, normaliseChain, toUnixSeconds, toNumber } from '../lib/shape.js';

export const DEFAULT_ENDPOINT_CONFIG_PATH = resolve(PROJECT_ROOT, 'config', 'frontrun.endpoints.json');

/**
 * @param {string} [path]
 * @returns {{version:number, defaults:object, endpoints:Record<string,any>}}
 */
export function loadEndpointConfig(path = DEFAULT_ENDPOINT_CONFIG_PATH) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed.endpoints || typeof parsed.endpoints !== 'object') {
    throw new Error(`endpoint config at ${path} has no "endpoints" object`);
  }
  return parsed;
}

/**
 * Substitute {{token}} placeholders from a params object.
 * Params that are undefined/null drop out of the query string entirely.
 * @param {Record<string,string>} template
 * @param {Record<string,unknown>} params
 * @returns {Record<string,string>}
 */
export function renderQuery(template, params) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const [key, rawValue] of Object.entries(template ?? {})) {
    const match = /^\{\{(\w+)\}\}$/.exec(String(rawValue));
    if (match) {
      const value = params[match[1]];
      if (value === undefined || value === null || value === '') continue;
      out[key] = String(value);
    } else {
      out[key] = String(rawValue);
    }
  }
  return out;
}

/**
 * Substitute {{token}} placeholders inside a path, e.g. /wallet/{{address}}/labels.
 * @param {string} template
 * @param {Record<string,unknown>} params
 */
export function renderPath(template, params) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    const value = params[key];
    return value === undefined || value === null ? whole : encodeURIComponent(String(value));
  });
}

export class FrontrunClient {
  /**
   * @param {{apiKey:string, baseUrl:string, authHeader:string, authPrefix?:string, maxRpm:number}} options
   * @param {{config?:object, fetchImpl?:typeof fetch, onCall?:(info:object)=>void}} [deps]
   */
  constructor(options, deps = {}) {
    if (!options?.apiKey) throw new Error('FrontrunClient requires an apiKey');
    this.options = options;
    this.config = deps.config ?? loadEndpointConfig();
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.onCall = deps.onCall ?? (() => {});
    this.limiter = new RateLimiter(options.maxRpm);
    /** @type {Array<{endpoint:string,url:string,status:number,count:number,durationMs:number,at:string}>} */
    this.callLog = [];
  }

  /** @returns {Record<string,string>} */
  authHeaders() {
    const prefix = this.options.authPrefix ? `${this.options.authPrefix} ` : '';
    return { [this.options.authHeader]: `${prefix}${this.options.apiKey}` };
  }

  /** @param {string} name */
  endpoint(name) {
    const definition = this.config.endpoints[name];
    if (!definition) {
      throw new Error(
        `endpoint "${name}" is not defined in config/frontrun.endpoints.json (have: ${Object.keys(this.config.endpoints).join(', ')})`,
      );
    }
    return definition;
  }

  /**
   * Build the full URL for an endpoint without sending anything. Useful for
   * `doctor` output and for tests.
   * @param {string} name
   * @param {Record<string,unknown>} params
   */
  buildUrl(name, params = {}) {
    const definition = this.endpoint(name);
    const url = new URL(renderPath(definition.path, params), `${this.options.baseUrl}/`);
    for (const [key, value] of Object.entries(renderQuery(definition.query, params))) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * Call one endpoint and return normalised records plus the raw payload.
   * @param {string} name
   * @param {Record<string,unknown>} [params]
   * @returns {Promise<{endpoint:string, url:string, status:number, durationMs:number, items:Record<string,unknown>[], raw:unknown}>}
   */
  async call(name, params = {}) {
    const definition = this.endpoint(name);
    const url = this.buildUrl(name, params);
    const defaults = this.config.defaults ?? {};

    const response = await this.limiter.schedule(() =>
      getJson(url, {
        headers: this.authHeaders(),
        timeoutMs: defaults.timeoutMs ?? 20_000,
        retries: defaults.retries ?? 2,
        backoffMs: defaults.retryBackoffMs ?? 800,
        fetchImpl: this.fetchImpl,
      }),
    );

    const rawItems = selectArray(response.body, definition.select);
    const items = rawItems
      .filter((item) => item && typeof item === 'object')
      .map((item) => normaliseRecord(/** @type {any} */ (item), definition.fieldMap));

    const entry = {
      endpoint: name,
      url: redact(url),
      status: response.status,
      count: items.length,
      durationMs: response.durationMs,
      at: new Date().toISOString(),
    };
    this.callLog.push(entry);
    this.onCall(entry);

    return { ...entry, items, raw: response.body };
  }

  // ---- typed wrappers -----------------------------------------------------

  /** @param {{limit?:number}} [options] */
  async trendingAccounts({ limit = 25 } = {}) {
    const { items, ...meta } = await this.call('trendingAccounts', { limit });
    return {
      ...meta,
      items: items.map((item) => ({
        handle: cleanHandle(item.handle),
        smartFollowers: toNumber(item.smartFollowers),
        followerDelta: toNumber(item.followerDelta),
        profileUrl: item.profileUrl ?? null,
      })),
    };
  }

  /** @param {string} handle @param {{limit?:number}} [options] */
  async smartFollowers(handle, { limit = 20 } = {}) {
    const { items, ...meta } = await this.call('smartFollowers', { handle: cleanHandle(handle), limit });
    return {
      ...meta,
      items: items.map((item) => ({
        handle: cleanHandle(item.handle),
        followers: toNumber(item.followers),
        tags: asArray(item.tags),
      })),
    };
  }

  /**
   * Contract addresses a handle has called, newest first.
   * @param {string} handle @param {{limit?:number}} [options]
   */
  async caHistory(handle, { limit = 100 } = {}) {
    const { items, ...meta } = await this.call('caHistory', { handle: cleanHandle(handle), limit });
    const calls = items
      .map((item) => ({
        handle: cleanHandle(item.handle ?? handle),
        contract: typeof item.contract === 'string' ? item.contract.trim() : null,
        chain: normaliseChain(item.chain, item.contract),
        symbol: item.symbol ?? null,
        calledAt: toUnixSeconds(item.calledAt),
        tweetUrl: item.tweetUrl ?? null,
        tweetId: item.tweetId ?? null,
        deleted: Boolean(item.deleted),
      }))
      .filter((call) => call.contract && call.calledAt)
      .sort((a, b) => b.calledAt - a.calledAt);
    return { ...meta, items: calls };
  }

  /** @param {string} handle */
  async linkedWallets(handle) {
    const { items, ...meta } = await this.call('linkedWallets', { handle: cleanHandle(handle) });
    return {
      ...meta,
      items: items
        .map((item) => ({
          address: typeof item.address === 'string' ? item.address.trim() : null,
          chain: normaliseChain(item.chain, item.address),
          source: item.source ?? null,
          confidence: toNumber(item.confidence),
        }))
        .filter((wallet) => wallet.address),
    };
  }

  /** @param {string} handle @param {{limit?:number}} [options] */
  async mentionedWallets(handle, { limit = 50 } = {}) {
    const { items, ...meta } = await this.call('mentionedWallets', { handle: cleanHandle(handle), limit });
    return {
      ...meta,
      items: items
        .map((item) => ({
          address: typeof item.address === 'string' ? item.address.trim() : null,
          chain: normaliseChain(item.chain, item.address),
          mentionedAt: toUnixSeconds(item.mentionedAt),
          tweetUrl: item.tweetUrl ?? null,
        }))
        .filter((wallet) => wallet.address),
    };
  }

  /** @param {string} address @param {{chain?:string}} [options] */
  async walletLabels(address, { chain = 'solana' } = {}) {
    const { items, ...meta } = await this.call('walletLabels', { address, chain });
    return {
      ...meta,
      items: items.map((item) => ({
        label: item.label ?? null,
        category: item.category ?? null,
        source: item.source ?? null,
      })),
    };
  }

  /** @param {{chain?:string, limit?:number, period?:string}} [options] */
  async pnlLeaderboard({ chain = 'solana', limit = 50, period = '7d' } = {}) {
    const { items, ...meta } = await this.call('pnlLeaderboard', { chain, limit, period });
    return {
      ...meta,
      items: items
        .map((item) => ({
          address: typeof item.address === 'string' ? item.address.trim() : null,
          chain: normaliseChain(item.chain ?? chain, item.address),
          realizedPnlUsd: toNumber(item.realizedPnlUsd),
          winRate: toNumber(item.winRate),
          trades: toNumber(item.trades),
          labels: asArray(item.labels),
        }))
        .filter((wallet) => wallet.address),
    };
  }

  /**
   * Probe every configured endpoint once and report what answered.
   * This is what `npm run doctor` prints; it is also how you confirm the
   * endpoint map matches the real hackathon docs.
   * @param {Record<string,unknown>} sampleParams
   */
  async healthCheck(sampleParams = {}) {
    const results = [];
    for (const name of Object.keys(this.config.endpoints)) {
      const definition = this.config.endpoints[name];
      const url = this.buildUrl(name, sampleParams);
      try {
        const result = await this.call(name, sampleParams);
        results.push({
          endpoint: name,
          kind: definition.kind,
          url: redact(url),
          ok: true,
          status: result.status,
          items: result.items.length,
          sampleKeys: result.items[0] ? Object.keys(result.items[0]._raw ?? {}).slice(0, 12) : [],
        });
      } catch (error) {
        results.push({
          endpoint: name,
          kind: definition.kind,
          url: redact(url),
          ok: false,
          status: error instanceof HttpError ? error.status : 0,
          error: error.message,
        });
      }
    }
    return results;
  }
}

/** @param {unknown} handle */
export function cleanHandle(handle) {
  if (typeof handle !== 'string') return null;
  const trimmed = handle.trim().replace(/^@/, '');
  const fromUrl = /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})/i.exec(trimmed);
  const value = fromUrl ? fromUrl[1] : trimmed;
  return /^[A-Za-z0-9_]{1,15}$/.test(value) ? value : null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') return value.split(',').map((part) => part.trim());
  return [];
}
