/**
 * Read-only Solana JSON-RPC.
 *
 * Scope is deliberately tiny and safe:
 *  - getHealth
 *  - getTokenAccountsByOwner (jsonParsed) to see whether a linked wallet
 *    actually holds a token its owner called
 *
 * This module never builds, signs or sends a transaction, never asks for a
 * private key or seed phrase, and never requests an approval. It only reads.
 */

import { RateLimiter, sleep } from '../lib/http.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PUBLIC_RPM = 60;

export class SolanaReader {
  /**
   * @param {{rpcUrl:string}} options
   * @param {{fetchImpl?:typeof fetch}} [deps]
   */
  constructor(options, deps = {}) {
    this.rpcUrl = options.rpcUrl;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.limiter = new RateLimiter(PUBLIC_RPM);
    this.requestId = 0;
  }

  /**
   * @param {string} method
   * @param {unknown[]} params
   */
  async rpc(method, params = []) {
    if (!READ_ONLY_METHODS.has(method)) {
      throw new Error(`refusing to call non-read RPC method "${method}"`);
    }
    this.requestId += 1;
    const body = JSON.stringify({ jsonrpc: '2.0', id: this.requestId, method, params });

    return this.limiter.schedule(async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await this.fetchImpl(this.rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(20_000),
          });
          const json = await response.json();
          if (json?.error) throw new Error(`RPC ${method}: ${json.error.message ?? 'unknown error'}`);
          return json?.result;
        } catch (error) {
          lastError = error;
          await sleep(500 * 2 ** attempt);
        }
      }
      throw lastError;
    });
  }

  async health() {
    return this.rpc('getHealth');
  }

  /**
   * Current SPL balance of `mint` held by `owner`, summed across both token
   * programs. Returns 0 when the wallet holds none.
   * @param {string} owner
   * @param {string} mint
   * @returns {Promise<{uiAmount:number, accounts:number}>}
   */
  async tokenBalance(owner, mint) {
    let uiAmount = 0;
    let accounts = 0;
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      let result;
      try {
        result = await this.rpc('getTokenAccountsByOwner', [
          owner,
          { mint, programId },
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ]);
      } catch {
        continue;
      }
      for (const account of result?.value ?? []) {
        const amount = account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
        if (Number.isFinite(amount)) {
          uiAmount += amount;
          accounts += 1;
        }
      }
    }
    return { uiAmount, accounts };
  }
}

/** Allow-list: any method not in here is rejected before it reaches the network. */
export const READ_ONLY_METHODS = new Set([
  'getHealth',
  'getAccountInfo',
  'getBalance',
  'getTokenAccountsByOwner',
  'getTokenSupply',
  'getSignaturesForAddress',
  'getSlot',
]);
