import test from 'node:test';
import assert from 'node:assert/strict';
import { FrontrunClient, renderQuery, renderPath, cleanHandle, loadEndpointConfig } from '../src/frontrun/client.js';
import { HttpError } from '../src/lib/http.js';

const CONFIG = loadEndpointConfig();
const OPTIONS = { apiKey: 'test-key-123456', baseUrl: 'https://api.example.test', authHeader: 'x-api-key', maxRpm: 6000 };

/**
 * A fetch stand-in. Records the calls, replies with whatever the script says.
 * Nothing in src/ ever ships a stub like this - it exists only for tests.
 */
function stubFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const reply = responder(url, init);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)),
    };
  };
  impl.calls = calls;
  return impl;
}

test('renderQuery substitutes placeholders and drops missing params', () => {
  assert.deepEqual(renderQuery({ handle: '{{handle}}', limit: '{{limit}}', fixed: 'x' }, { handle: 'abc' }), {
    handle: 'abc',
    fixed: 'x',
  });
});

test('renderPath substitutes and url-encodes path placeholders', () => {
  assert.equal(renderPath('/wallet/{{address}}/labels', { address: 'A B' }), '/wallet/A%20B/labels');
  assert.equal(renderPath('/static/path', {}), '/static/path');
});

test('cleanHandle strips @, extracts from a URL, and rejects junk', () => {
  assert.equal(cleanHandle('@frontrunpro'), 'frontrunpro');
  assert.equal(cleanHandle('https://x.com/frontrunpro/status/1'), 'frontrunpro');
  assert.equal(cleanHandle('not a handle!'), null);
  assert.equal(cleanHandle(123), null);
});

test('client refuses to construct without an api key', () => {
  assert.throws(() => new FrontrunClient({ ...OPTIONS, apiKey: '' }), /requires an apiKey/);
});

test('client sends the configured auth header and never puts the key in the URL', async () => {
  const fetchImpl = stubFetch(() => ({ status: 200, body: { data: { items: [] } } }));
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  await client.call('trendingAccounts', { limit: 5 });

  const { url, init } = fetchImpl.calls[0];
  assert.equal(init.headers['x-api-key'], 'test-key-123456');
  assert.ok(!url.includes('test-key-123456'), 'the key must never appear in a URL');
});

test('client supports an Authorization: Bearer style header', async () => {
  const fetchImpl = stubFetch(() => ({ status: 200, body: { data: [] } }));
  const client = new FrontrunClient(
    { ...OPTIONS, authHeader: 'Authorization', authPrefix: 'Bearer' },
    { config: CONFIG, fetchImpl },
  );
  await client.call('trendingAccounts', {});
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer test-key-123456');
});

test('caHistory normalises three different response shapes into the same records', async () => {
  const shapes = [
    { data: { items: [{ ca: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', tweeted_at: 1_750_000_000, chain: 'SOL' }] } },
    { result: [{ contract_address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', createdAt: '2025-06-15T15:06:40Z', network: 'solana' }] },
    { list: [{ address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', timestamp: 1_750_000_000_000 }] },
  ];
  for (const body of shapes) {
    const fetchImpl = stubFetch(() => ({ status: 200, body }));
    const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
    const result = await client.caHistory('someone');
    assert.equal(result.items.length, 1, JSON.stringify(body));
    assert.equal(result.items[0].contract, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
    assert.equal(result.items[0].chain, 'solana');
    assert.equal(result.items[0].calledAt, 1_750_000_000);
  }
});

test('caHistory drops records without a contract or a timestamp rather than guessing', async () => {
  const fetchImpl = stubFetch(() => ({
    status: 200,
    body: {
      data: [
        { ca: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', tweeted_at: 1_750_000_000 },
        { ca: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263' },
        { tweeted_at: 1_750_000_000 },
      ],
    },
  }));
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  const result = await client.caHistory('someone');
  assert.equal(result.items.length, 1);
});

test('caHistory returns calls newest first', async () => {
  const fetchImpl = stubFetch(() => ({
    status: 200,
    body: {
      data: [
        { ca: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', tweeted_at: 1_700_000_000 },
        { ca: 'So11111111111111111111111111111111111111112', tweeted_at: 1_760_000_000 },
      ],
    },
  }));
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  const result = await client.caHistory('someone');
  assert.equal(result.items[0].calledAt, 1_760_000_000);
});

test('client surfaces an auth failure instead of falling back to sample data', async () => {
  const fetchImpl = stubFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }));
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  await assert.rejects(() => client.caHistory('someone'), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 401);
    return true;
  });
});

test('client logs every request it makes, for the receipts section', async () => {
  const fetchImpl = stubFetch(() => ({ status: 200, body: { data: [{ address: 'WalletA', chain: 'solana' }] } }));
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  await client.linkedWallets('someone');
  assert.equal(client.callLog.length, 1);
  assert.equal(client.callLog[0].endpoint, 'linkedWallets');
  assert.equal(client.callLog[0].count, 1);
});

test('healthCheck reports every endpoint, failures included', async () => {
  const fetchImpl = stubFetch((url) =>
    url.includes('ca-history') ? { status: 404, body: { message: 'nope' } } : { status: 200, body: { data: [] } },
  );
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl });
  const results = await client.healthCheck({ handle: 'x', address: 'y', chain: 'solana', limit: 1 });
  assert.equal(results.length, Object.keys(CONFIG.endpoints).length);
  const caHistory = results.find((result) => result.endpoint === 'caHistory');
  assert.equal(caHistory.ok, false);
  assert.equal(caHistory.status, 404);
});

test('an unknown endpoint name fails loudly with the available names', () => {
  const client = new FrontrunClient(OPTIONS, { config: CONFIG, fetchImpl: stubFetch(() => ({ status: 200, body: {} })) });
  assert.throws(() => client.buildUrl('doesNotExist'), /not defined in config/);
});
