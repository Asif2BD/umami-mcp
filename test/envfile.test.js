import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile } from '../dist/envfile.js';

const write = (name, body, mode = 0o600) => {
  const p = join(mkdtempSync(join(tmpdir(), 'umami-mcp-')), name);
  writeFileSync(p, body);
  chmodSync(p, mode);
  return p;
};

test('loads keys from an explicitly named file', () => {
  const p = write('env', 'UMAMI_URL=https://x.example.com\nUMAMI_PASSWORD=secret123\n');
  const env = { UMAMI_MCP_ENV_FILE: p };
  const r = loadEnvFile(env);
  assert.equal(r.loaded, 2);
  assert.equal(env.UMAMI_URL, 'https://x.example.com');
  assert.equal(env.UMAMI_PASSWORD, 'secret123');
});

test('the real environment wins over the file', () => {
  const p = write('env', 'UMAMI_PASSWORD=from-file\n');
  const env = { UMAMI_MCP_ENV_FILE: p, UMAMI_PASSWORD: 'from-env' };
  loadEnvFile(env);
  assert.equal(env.UMAMI_PASSWORD, 'from-env');
});

test('ignores comments and blank lines, and strips export', () => {
  const p = write('env', '# a comment\n\nexport UMAMI_URL=https://y.example.com\n');
  const env = { UMAMI_MCP_ENV_FILE: p };
  loadEnvFile(env);
  assert.equal(env.UMAMI_URL, 'https://y.example.com');
});

test('preserves passwords containing # and spaces', () => {
  const p = write('env', 'UMAMI_PASSWORD="p@ss #word with spaces"\n');
  const env = { UMAMI_MCP_ENV_FILE: p };
  loadEnvFile(env);
  assert.equal(env.UMAMI_PASSWORD, 'p@ss #word with spaces');
});

test('warns when the file is readable by others', () => {
  const p = write('env', 'UMAMI_URL=https://z.example.com\n', 0o644);
  const r = loadEnvFile({ UMAMI_MCP_ENV_FILE: p });
  assert.ok(r.warnings.some((w) => w.includes('chmod 600')));
});

test('does not warn when the file is 600', () => {
  const p = write('env', 'UMAMI_URL=https://z.example.com\n', 0o600);
  const r = loadEnvFile({ UMAMI_MCP_ENV_FILE: p });
  assert.deepEqual(r.warnings, []);
});

test('warns when an explicitly named file is missing', () => {
  const r = loadEnvFile({ UMAMI_MCP_ENV_FILE: '/nonexistent/umami/env' });
  assert.equal(r.loaded, 0);
  assert.ok(r.warnings.some((w) => w.includes('could not be read')));
});
