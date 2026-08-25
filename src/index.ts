#!/usr/bin/env node
import http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, describeConfig, ConfigError, type Config } from './config.js';
import { loadEnvFile } from './envfile.js';
import { UmamiClient } from './client.js';
import { registerSecrets, redactUnknown } from './redact.js';
import { buildServer } from './server.js';

/**
 * On stdio, stdout carries the JSON-RPC stream and must never be polluted.
 * All human-facing logging therefore goes to stderr.
 */
const log = (...args: unknown[]) => console.error('[umami-mcp]', ...args);

async function startStdio(config: Config, client: UmamiClient) {
  const { server, registered, withheld } = buildServer(config, client);
  log(`${registered.length} tools available, ${withheld.length} withheld by mode "${config.mode}"`);
  await server.connect(new StdioServerTransport());
  log('ready on stdio');
}

async function startHttp(config: Config, client: UmamiClient) {
  const { server, registered, withheld } = buildServer(config, client);

  // Stateless: every request is self-contained, so there is no session store
  // to leak between callers and no cleanup to get wrong.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: config.mode, tools: registered.length }));
      return;
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found; the MCP endpoint is /mcp' }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: unknown;
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'malformed JSON body' }));
          return;
        }
      }
      transport.handleRequest(req, res, body).catch((err) => {
        log('request failed:', redactUnknown(err));
        if (!res.headersSent) res.writeHead(500).end();
      });
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(config.port, config.host, resolve));
  log(`${registered.length} tools available, ${withheld.length} withheld by mode "${config.mode}"`);
  log(`ready on http://${config.host}:${config.port}/mcp`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    log(
      `WARNING: bound to ${config.host}, which may be reachable from the network. ` +
        'This server has no authentication of its own -- anyone who can reach it can use your Umami credentials. ' +
        'Bind to 127.0.0.1 and use an SSH tunnel, or put an authenticating proxy in front.',
    );
  }
}

async function main() {
  // Credentials may live in a file the operator controls rather than in the
  // MCP client's config JSON. Must run before loadConfig reads the env.
  const envFile = loadEnvFile();
  if (envFile.path && envFile.loaded > 0) {
    log(`loaded ${envFile.loaded} setting(s) from ${envFile.path}`);
  }
  for (const w of envFile.warnings) log(`WARNING: ${w}`);

  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      log('configuration error:', err.message);
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  // Must happen before any request can produce output.
  registerSecrets(config.password, config.apiKey);

  log(describeConfig(config));

  const client = new UmamiClient(config);
  try {
    const user = await client.verify();
    log(`connected as ${user.username} (role: ${user.role})`);
  } catch (err) {
    log('could not reach Umami:', redactUnknown(err));
    log('check UMAMI_URL and your credentials, then restart.');
    process.exit(69); // EX_UNAVAILABLE
  }

  if (config.transport === 'http') await startHttp(config, client);
  else await startStdio(config, client);
}

main().catch((err) => {
  log('fatal:', redactUnknown(err));
  process.exit(1);
});
