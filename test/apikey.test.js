import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiKeyHeader } from '../dist/client.js';
import { redact } from '../dist/redact.js';

test('self-hosted API keys go in Authorization: Bearer', () => {
  assert.deepEqual(apiKeyHeader('https://analytics.example.com', 'umami_abc'), {
    authorization: 'Bearer umami_abc',
  });
});

test('Umami Cloud API keys go in x-umami-api-key', () => {
  assert.deepEqual(apiKeyHeader('https://api.umami.is', 'k1'), { 'x-umami-api-key': 'k1' });
  assert.deepEqual(apiKeyHeader('https://umami.is', 'k1'), { 'x-umami-api-key': 'k1' });
});

test('a lookalike host is not treated as Umami Cloud', () => {
  assert.deepEqual(apiKeyHeader('https://notumami.is', 'k1'), { authorization: 'Bearer k1' });
});

test('bare self-hosted API keys are redacted', () => {
  assert.equal(redact('key umami_0123456789abcdefXYZ leaked'), 'key [redacted-api-key] leaked');
});
