import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../dist/config.js';

const base = { UMAMI_URL: 'https://a.example.com', UMAMI_USERNAME: 'u', UMAMI_PASSWORD: 'p' };

test('requires a URL', () => {
  assert.throws(() => loadConfig({ ...base, UMAMI_URL: '' }), ConfigError);
});

test('requires credentials', () => {
  assert.throws(() => loadConfig({ UMAMI_URL: 'https://a.example.com' }), ConfigError);
});

test('accepts an API key instead of username/password', () => {
  const c = loadConfig({ UMAMI_URL: 'https://a.example.com', UMAMI_API_KEY: 'k'.repeat(20) });
  assert.equal(c.apiKey, 'k'.repeat(20));
});

test('refuses plaintext HTTP to a remote host', () => {
  assert.throws(() => loadConfig({ ...base, UMAMI_URL: 'http://remote.example.com' }), ConfigError);
});

test('allows plaintext HTTP on loopback for local development', () => {
  const c = loadConfig({ ...base, UMAMI_URL: 'http://localhost:3000' });
  assert.equal(c.url, 'http://localhost:3000');
});

test('defaults to the least privilege', () => {
  const c = loadConfig(base);
  assert.equal(c.mode, 'read');
  assert.equal(c.allowDestructive, false);
  assert.equal(c.transport, 'stdio');
  assert.equal(c.host, '127.0.0.1');
});

test('rejects an unknown mode', () => {
  assert.throws(() => loadConfig({ ...base, UMAMI_MCP_MODE: 'root' }), ConfigError);
});

test('strips a trailing slash from the URL', () => {
  assert.equal(loadConfig({ ...base, UMAMI_URL: 'https://a.example.com/' }).url, 'https://a.example.com');
});
