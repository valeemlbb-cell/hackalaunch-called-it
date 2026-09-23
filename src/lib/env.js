/**
 * Environment loading and validation.
 * Reads a local .env if present (no dotenv dependency) and fails fast with a
 * readable message when a required variable is missing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Parse a .env file body into key/value pairs. Supports `export KEY=value`,
 * quoted values and `#` comments. Does not do variable interpolation.
 * @param {string} contents
 * @returns {Record<string,string>}
 */
export function parseEnvFile(contents) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const rawLine of String(contents).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.split(' #')[0].trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load .env into process.env without overwriting variables already set.
 * @param {string} [envPath]
 */
export function loadDotEnv(envPath = resolve(PROJECT_ROOT, '.env')) {
  if (!existsSync(envPath)) return {};
  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return parsed;
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULTS = {
  FRONTRUN_BASE_URL: 'https://api.frontrun.pro',
  FRONTRUN_AUTH_HEADER: 'x-api-key',
  FRONTRUN_AUTH_PREFIX: '',
  FRONTRUN_MAX_RPM: '60',
  SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
  GECKOTERMINAL_BASE_URL: 'https://api.geckoterminal.com/api/v2',
  PORT: '8788',
};

/**
 * Build the typed config object used by the rest of the app.
 * @param {Record<string,string|undefined>} [source]
 * @param {{requireApiKey?:boolean}} [options]
 */
export function loadConfig(source = process.env, options = {}) {
  const { requireApiKey = true } = options;
  const read = (key) => {
    const value = source[key];
    return value === undefined || value === '' ? DEFAULTS[key] : value;
  };

  const apiKey = source.FRONTRUN_API_KEY ?? '';
  if (requireApiKey && apiKey.trim() === '') {
    throw new ConfigError(
      'FRONTRUN_API_KEY is not set.\n' +
        'Called It never mocks or hardcodes Frontrun responses, so it cannot run without a key.\n' +
        'Copy .env.example to .env and paste your hackathon / Gold-plan key, then re-run.',
    );
  }

  const maxRpm = Number(read('FRONTRUN_MAX_RPM'));
  if (!Number.isFinite(maxRpm) || maxRpm <= 0) {
    throw new ConfigError('FRONTRUN_MAX_RPM must be a positive number.');
  }

  return Object.freeze({
    frontrun: Object.freeze({
      apiKey,
      baseUrl: stripTrailingSlash(read('FRONTRUN_BASE_URL')),
      authHeader: read('FRONTRUN_AUTH_HEADER'),
      authPrefix: read('FRONTRUN_AUTH_PREFIX'),
      maxRpm,
    }),
    solanaRpcUrl: read('SOLANA_RPC_URL'),
    geckoTerminalBaseUrl: stripTrailingSlash(read('GECKOTERMINAL_BASE_URL')),
    port: Number(read('PORT')),
  });
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

/**
 * Never print a key. Show enough to confirm which key is loaded.
 * @param {string} key
 */
export function maskKey(key) {
  const value = String(key ?? '');
  if (value.length <= 8) return value === '' ? '(unset)' : '***';
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
}
