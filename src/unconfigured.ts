import { ConfigError, type Config } from './config.js';
import type { UmamiClient } from './client.js';

/**
 * Used when the server is started over stdio with no usable configuration --
 * most often by a registry or directory (Glama, MCP inspectors) that launches
 * the server only to list its tools.
 *
 * Exiting in that case makes the server look broken to anything that just
 * wants to see what it offers. Instead it starts with the least-privileged
 * tool set, and every tool call fails with the original configuration error
 * so a real user still sees exactly what to fix.
 *
 * No request is ever sent anywhere in this mode: there is no URL to send it to.
 */
export function unconfiguredConfig(): Config {
  return {
    url: '',
    teamId: undefined,
    // Always read-only: an unconfigured process has no business advertising
    // write or admin tools, whatever UMAMI_MCP_MODE says.
    mode: 'read',
    allowDestructive: false,
    transport: 'stdio',
    host: '127.0.0.1',
    port: 3334,
    timeoutMs: 30_000,
    oauth: undefined,
  };
}

export function unconfiguredMessage(reason: string): string {
  return (
    `umami-mcp is not configured: ${reason} ` +
    'Set the environment variables in your MCP client config and restart the server.'
  );
}

/** Belt and braces: even if a call slipped past the server's guard, nothing is sent. */
export function unconfiguredClient(reason: string): UmamiClient {
  const fail = async (): Promise<never> => {
    throw new ConfigError(unconfiguredMessage(reason));
  };
  return {
    request: fail,
    get: fail,
    post: fail,
    del: fail,
    verify: fail,
  } as unknown as UmamiClient;
}

/**
 * True when a failed configuration should still start the server for tool
 * listing: stdio only. An HTTP or OAuth deployment with bad settings must
 * keep failing loudly at boot -- it is a service, not an introspection target.
 */
export function canStartUnconfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const transport = (env.UMAMI_MCP_TRANSPORT ?? env.TRANSPORT ?? 'stdio').trim().toLowerCase();
  const oauth = ['1', 'true', 'yes', 'on'].includes((env.UMAMI_MCP_OAUTH ?? '').trim().toLowerCase());
  return transport === 'stdio' && !oauth;
}
