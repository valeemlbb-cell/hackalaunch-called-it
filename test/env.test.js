import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, loadConfig, ConfigError, maskKey } from '../src/lib/env.js';
import { redact, RateLimiter } from '../src/lib/http.js';

test('parseEnvFile handles export, quotes, comments and blank lines', () => {
  const parsed = parseEnvFile(`
# a comment
export FRONTRUN_API_KEY="abc 123"
FRONTRUN_BASE_URL=https://api.example.test
EMPTY=
WITH_COMMENT=value # trailing
SINGLE='quoted'
not a pair
`);
  assert.equal(parsed.FRONTRUN_API_KEY, 'abc 123');
  assert.equal(parsed.FRONTRUN_BASE_URL, 'https://api.example.test');
  assert.equal(parsed.EMPTY, '');
  assert.equal(parsed.WITH_COMMENT, 'value');
  assert.equal(parsed.SINGLE, 'quoted');
});

test('loadConfig refuses to run without an API key, with an actionable message', () => {
  assert.throws(
    () => loadConfig({}, { requireApiKey: true }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /never mocks/);
      return true;
    },
  );
});

test('loadConfig fills defaults and strips trailing slashes', () => {
  const config = loadConfig({ FRONTRUN_API_KEY: 'k', FRONTRUN_BASE_URL: 'https://api.example.test/' });
  assert.equal(config.frontrun.baseUrl, 'https://api.example.test');
  assert.equal(config.frontrun.authHeader, 'x-api-key');
  assert.equal(config.frontrun.maxRpm, 60);
  assert.equal(config.solanaRpcUrl, 'https://api.mainnet-beta.solana.com');
});

test('loadConfig rejects a nonsense rate limit', () => {
  assert.throws(() => loadConfig({ FRONTRUN_API_KEY: 'k', FRONTRUN_MAX_RPM: 'fast' }), /positive number/);
});

test('loadConfig can skip the key requirement for offline commands like serve', () => {
  const config = loadConfig({}, { requireApiKey: false });
  assert.equal(config.frontrun.apiKey, '');
});

test('maskKey never reveals the middle of a key', () => {
  const masked = maskKey('sk-supersecretvalue-0000');
  assert.ok(!masked.includes('supersecret'));
  assert.match(masked, /^sk-s\.\.\.0000/);
  assert.equal(maskKey(''), '(unset)');
  assert.equal(maskKey('short'), '***');
});

test('redact strips credential-looking query params from logged urls', () => {
  assert.equal(redact('https://x.test/a?api_key=SECRET&handle=bob'), 'https://x.test/a?api_key=***&handle=bob');
  assert.equal(redact('https://x.test/a?token=SECRET'), 'https://x.test/a?token=***');
});

test('RateLimiter spaces calls out and keeps running after a rejection', async () => {
  const limiter = new RateLimiter(6000); // 10ms apart
  const started = [];
  const tasks = [
    limiter.schedule(async () => {
      started.push(Date.now());
      throw new Error('boom');
    }).catch(() => 'handled'),
    limiter.schedule(async () => {
      started.push(Date.now());
      return 'ok';
    }),
  ];
  const results = await Promise.all(tasks);
  assert.deepEqual(results, ['handled', 'ok']);
  assert.ok(started[1] - started[0] >= 9, 'second call waited for the interval');
});

test('RateLimiter with a non-positive rpm does not block', async () => {
  const limiter = new RateLimiter(0);
  assert.equal(await limiter.schedule(async () => 1), 1);
});
