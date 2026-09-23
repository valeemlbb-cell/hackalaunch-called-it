/**
 * Small HTTP layer: a token-bucket throttle plus retrying JSON fetch.
 * No dependencies - Node 20+ ships fetch and AbortSignal.timeout.
 */

const MS_PER_MINUTE = 60_000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Serialises calls so we never exceed `requestsPerMinute`.
 * Deliberately conservative: the hackathon rules forbid working around
 * documented rate limits, so the client throttles itself.
 */
export class RateLimiter {
  /** @param {number} requestsPerMinute */
  constructor(requestsPerMinute) {
    const rpm = Number(requestsPerMinute);
    this.minIntervalMs = rpm > 0 ? Math.ceil(MS_PER_MINUTE / rpm) : 0;
    this.chain = Promise.resolve();
    this.lastStartedAt = 0;
  }

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  schedule(task) {
    const run = this.chain.then(async () => {
      const wait = this.lastStartedAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStartedAt = Date.now();
      return task();
    });
    // Keep the chain alive even when a task rejects.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/** @param {number} ms */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {{status:number, url:string, body?:string}} details
   */
  constructor(message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = details.status;
    this.url = details.url;
    this.body = details.body;
  }
}

/**
 * GET JSON with bounded retries on transient failures.
 * @param {string} url
 * @param {{headers?:Record<string,string>, timeoutMs?:number, retries?:number, backoffMs?:number, fetchImpl?:typeof fetch}} [options]
 * @returns {Promise<{status:number, body:unknown, durationMs:number}>}
 */
export async function getJson(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 20_000,
    retries = 2,
    backoffMs = 800,
    fetchImpl = fetch,
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        const error = new HttpError(`HTTP ${response.status} for ${redact(url)}`, {
          status: response.status,
          url: redact(url),
          body: text.slice(0, 500),
        });
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = error;
          await sleep(backoffMs * 2 ** attempt);
          continue;
        }
        throw error;
      }

      return { status: response.status, body: parseJson(text), durationMs };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt >= retries) break;
      await sleep(backoffMs * 2 ** attempt);
    }
  }
  throw lastError ?? new Error(`request failed: ${redact(url)}`);
}

function parseJson(text) {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _nonJsonBody: text.slice(0, 1000) };
  }
}

/**
 * Strip anything that looks like a credential before a URL reaches a log line.
 * @param {string} url
 */
export function redact(url) {
  return String(url).replace(/([?&](api[-_]?key|key|token|secret)=)[^&]*/gi, '$1***');
}
