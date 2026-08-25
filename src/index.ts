#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startHttp } from './http.js';
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

  if (config.oauth?.enabled) {
    // Multi-tenant: there is no instance to verify at boot. Each user proves
    // their own credentials on the consent screen before a token is issued.
    if (config.transport !== 'http') {
      log('OAuth mode requires the http transport. Set UMAMI_MCP_TRANSPORT=http.');
      process.exit(78);
    }
    await startHttp({ config, log });
    return;
  }

  const client = new UmamiClient(config);
  try {
    const user = await client.verify();
    log(`connected as ${user.username} (role: ${user.role})`);
  } catch (err) {
    log('could not reach Umami:', redactUnknown(err));
    log('check UMAMI_URL and your credentials, then restart.');
    process.exit(69); // EX_UNAVAILABLE
  }

  if (config.transport === 'http') await startHttp({ config, log });
  else await startStdio(config, client);
}

main().catch((err) => {
  log('fatal:', redactUnknown(err));
  process.exit(1);
});
