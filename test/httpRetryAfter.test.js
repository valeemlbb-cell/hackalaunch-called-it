import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterMs, MAX_RETRY_AFTER_MS } from '../src/lib/http.js';

test('reads Retry-After delay-seconds', () => {
  assert.equal(retryAfterMs('5'), 5000);
});

test('reads Retry-After as an HTTP date, relative to now', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  assert.equal(retryAfterMs('Thu, 24 Sep 2026 00:00:10 GMT', now), 10_000);
});

test('caps an absurd Retry-After instead of hanging the run', () => {
  assert.equal(retryAfterMs('99999'), MAX_RETRY_AFTER_MS);
});

test('ignores a missing, empty, past or unparseable Retry-After', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  assert.equal(retryAfterMs(undefined), null);
  assert.equal(retryAfterMs('  '), null);
  assert.equal(retryAfterMs('0'), null);
  assert.equal(retryAfterMs('soon'), null);
  assert.equal(retryAfterMs('Thu, 24 Sep 2026 00:00:00 GMT', now + 5000), null);
});
