import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, callTool, TOOLS } from '../src/mcp/server.js';
import { FrontrunClient, loadEndpointConfig } from '../src/frontrun/client.js';

const CONFIG = loadEndpointConfig();

function client(responder) {
  const fetchImpl = async (url) => {
    const reply = responder(url);
    return {
      ok: reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  };
  return new FrontrunClient(
    { apiKey: 'k', baseUrl: 'https://api.example.test', authHeader: 'x-api-key', maxRpm: 6000 },
    { config: CONFIG, fetchImpl },
  );
}

test('initialize advertises the tools capability', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, {});
  assert.equal(response.result.serverInfo.name, 'called-it');
  assert.ok(response.result.capabilities.tools);
});

test('tools/list returns every tool with an input schema', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {});
  assert.equal(response.result.tools.length, TOOLS.length);
  for (const tool of response.result.tools) {
    assert.ok(tool.name && tool.description && tool.inputSchema);
  }
});

test('no exposed tool can place a trade or read the api key', () => {
  const surface = JSON.stringify(TOOLS).toLowerCase();
  for (const forbidden of ['buy', 'sell', 'swap', 'execute', 'apikey', 'private']) {
    assert.ok(!surface.includes(`"${forbidden}`), `tool surface must not expose ${forbidden}`);
  }
});

test('notifications produce no response', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, {}), null);
});

test('an unknown method returns a JSON-RPC error', async () => {
  const response = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' }, {});
  assert.equal(response.error.code, -32601);
});

test('tools/call surfaces a failure as an isError result rather than crashing', async () => {
  const response = await handleMessage(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'does_not_exist' } },
    {},
  );
  assert.equal(response.result.isError, true);
  assert.match(response.result.content[0].text, /unknown tool/);
});

test('frontrun_trending passes through normalised accounts', async () => {
  const context = {
    client: client(() => ({ status: 200, body: { data: [{ username: 'alice', smart_followers: 12 }] } })),
    config: {},
  };
  const result = await callTool({ name: 'frontrun_trending', arguments: { limit: 5 } }, context);
  assert.deepEqual(result.accounts, [{ handle: 'alice', smartFollowers: 12, followerDelta: null, profileUrl: null }]);
});

test('wallet_xray returns labels and names the endpoint it used', async () => {
  const context = {
    client: client(() => ({ status: 200, body: { data: { labels: [{ name: 'Smart Money', type: 'trader' }] } } })),
    config: {},
  };
  const result = await callTool({ name: 'wallet_xray', arguments: { address: 'WalletA' } }, context);
  assert.equal(result.labels[0].label, 'Smart Money');
  assert.equal(result.endpoint, 'walletLabels');
});
