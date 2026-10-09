import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canStartUnconfigured, unconfiguredClient, unconfiguredConfig } from '../dist/unconfigured.js';
import { buildServer } from '../dist/server.js';

test('starts unconfigured only on stdio, never for http or OAuth', () => {
  assert.equal(canStartUnconfigured({}), true);
  assert.equal(canStartUnconfigured({ UMAMI_MCP_TRANSPORT: 'stdio' }), true);
  assert.equal(canStartUnconfigured({ UMAMI_MCP_TRANSPORT: 'http' }), false);
  assert.equal(canStartUnconfigured({ TRANSPORT: 'http' }), false);
  assert.equal(canStartUnconfigured({ UMAMI_MCP_OAUTH: 'true' }), false);
});

test('unconfigured mode advertises read-only tools', () => {
  const { registered, withheld } = buildServer(unconfiguredConfig(), unconfiguredClient('x'));
  assert.ok(registered.length > 0);
  assert.ok(withheld.length > 0);
  assert.ok(registered.every((t) => t.tier === 'read'));
});

test('every client call fails with the configuration error', async () => {
  const c = unconfiguredClient('UMAMI_URL is required.');
  await assert.rejects(() => c.get('/api/me'), /not configured: UMAMI_URL is required/);
  await assert.rejects(() => c.post('/api/websites', {}), /not configured/);
});

test('with no environment, the process answers tools/list over stdio', async () => {
  const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, UMAMI_MCP_ENV_FILE: '/nonexistent' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  let buf = '';
  const tools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tools/list reply')), 10_000);
    child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          resolve(msg.result.tools);
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
  });
  child.removeAllListeners('exit');
  child.kill();
  assert.ok(tools.length > 0);
  assert.ok(tools.some((t) => t.name === 'umami_list_websites'));
});

test('a tool call in unconfigured mode returns the configuration error, not empty data', async () => {
  const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, UMAMI_MCP_ENV_FILE: '/nonexistent' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  let buf = '';
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no tools/call reply')), 10_000);
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'umami_list_websites', arguments: {} } });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          resolve(msg.result);
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
  });
  child.kill();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not configured: UMAMI_URL is required/);
});

/** Starts the server with an empty environment and runs one tools/call. */
async function callUnconfigured(name, args) {
  const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, UMAMI_MCP_ENV_FILE: '/nonexistent' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
  let buf = '';
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no tools/call reply')), 10_000);
      child.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n').slice(0, -1)) {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
          }
          if (msg.id === 2) {
            clearTimeout(timer);
            resolve(msg.result);
          }
        }
        buf = buf.slice(buf.lastIndexOf('\n') + 1);
      });
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      });
    });
  } finally {
    child.kill();
  }
}

test('missing required arguments still get the configuration error, not a validation error', async () => {
  const result = await callUnconfigured('umami_get_stats', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not configured: UMAMI_URL is required/);
  assert.doesNotMatch(result.content[0].text, /Input validation error/);
});

test('an unknown tool name is still reported as unknown', async () => {
  const result = await callUnconfigured('umami_delete_everything', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Tool umami_delete_everything not found/);
});
