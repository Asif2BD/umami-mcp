/**
 * Configuration is read exclusively from the process environment.
 *
 * Nothing here is ever transmitted anywhere except to the single Umami
 * instance named by UMAMI_URL. There is no telemetry, no phone-home, and no
 * remote credential broker. If you self-host this server, your credentials
 * stay on your machine.
 */

export type Mode = 'read' | 'write' | 'admin';
export type Transport = 'stdio' | 'http';

export interface Config {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  teamId?: string;
  mode: Mode;
  allowDestructive: boolean;
  transport: Transport;
  host: string;
  port: number;
  timeoutMs: number;
}

export class ConfigError extends Error {}

const MODES: Mode[] = ['read', 'write', 'admin'];

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function int(v: string | undefined, fallback: number, name: string): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(`${name} must be a positive integer, got ${JSON.stringify(v)}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = (env.UMAMI_URL ?? '').trim().replace(/\/+$/, '');
  if (!rawUrl) {
    throw new ConfigError(
      'UMAMI_URL is required (e.g. https://analytics.example.com). ' +
        'See .env.example for the full list of settings.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(`UMAMI_URL is not a valid URL: ${JSON.stringify(rawUrl)}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(`UMAMI_URL must be http(s), got ${parsed.protocol}`);
  }
  // Credentials over plaintext HTTP are only tolerated on the loopback
  // interface, where there is no network to sniff.
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) {
    throw new ConfigError(
      `Refusing to send credentials over plaintext HTTP to ${parsed.hostname}. ` +
        'Use https://, or point UMAMI_URL at localhost for local development.',
    );
  }

  const username = env.UMAMI_USERNAME?.trim() || undefined;
  const password = env.UMAMI_PASSWORD ?? undefined;
  const apiKey = env.UMAMI_API_KEY?.trim() || undefined;

  if (!apiKey && !(username && password)) {
    throw new ConfigError(
      'No credentials found. Set UMAMI_USERNAME and UMAMI_PASSWORD (self-hosted), ' +
        'or UMAMI_API_KEY (Umami Cloud).',
    );
  }

  const rawMode = (env.UMAMI_MCP_MODE ?? 'read').trim().toLowerCase() as Mode;
  if (!MODES.includes(rawMode)) {
    throw new ConfigError(`UMAMI_MCP_MODE must be one of ${MODES.join(' | ')}, got ${JSON.stringify(rawMode)}`);
  }

  const rawTransport = (env.UMAMI_MCP_TRANSPORT ?? env.TRANSPORT ?? 'stdio').trim().toLowerCase() as Transport;
  if (rawTransport !== 'stdio' && rawTransport !== 'http') {
    throw new ConfigError(`transport must be "stdio" or "http", got ${JSON.stringify(rawTransport)}`);
  }

  return {
    url: rawUrl,
    username,
    password,
    apiKey,
    teamId: env.UMAMI_TEAM_ID?.trim() || undefined,
    mode: rawMode,
    allowDestructive: bool(env.UMAMI_MCP_ALLOW_DESTRUCTIVE, false),
    transport: rawTransport,
    host: (env.UMAMI_MCP_HOST ?? '127.0.0.1').trim(),
    port: int(env.UMAMI_MCP_PORT ?? env.PORT, 3334, 'UMAMI_MCP_PORT'),
    timeoutMs: int(env.UMAMI_MCP_TIMEOUT_MS, 30_000, 'UMAMI_MCP_TIMEOUT_MS'),
  };
}

/** Human-readable summary for startup logs. Never includes secrets. */
export function describeConfig(c: Config): string {
  const auth = c.apiKey ? 'api-key' : `user:${c.username}`;
  const destructive = c.allowDestructive ? ' +destructive' : '';
  return `${c.url} (auth=${auth}, mode=${c.mode}${destructive}, transport=${c.transport})`;
}
