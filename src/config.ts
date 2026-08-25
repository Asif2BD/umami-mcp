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

export interface OAuthConfig {
  enabled: boolean;
  issuer: string;
  tokenKey: string;
  ttlSeconds: number;
  /** When set, every user is pinned to this Umami rather than choosing one. */
  fixedUrl?: string;
}

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
  oauth?: OAuthConfig;
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
  // In OAuth mode this server is multi-tenant: each user supplies their own
  // Umami and their own login at consent time, so the process itself holds no
  // instance URL and no credentials.
  const oauthEnabled = bool(env.UMAMI_MCP_OAUTH, false);

  const rawUrl = (env.UMAMI_URL ?? '').trim().replace(/\/+$/, '');
  if (!rawUrl && !oauthEnabled) {
    throw new ConfigError(
      'UMAMI_URL is required (e.g. https://analytics.example.com). ' +
        'See .env.example for the full list of settings.',
    );
  }

  let parsed: URL | undefined;
  if (rawUrl) {
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new ConfigError(`UMAMI_URL is not a valid URL: ${JSON.stringify(rawUrl)}`);
    }
  }
  if (parsed && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ConfigError(`UMAMI_URL must be http(s), got ${parsed.protocol}`);
  }
  // Credentials over plaintext HTTP are only tolerated on the loopback
  // interface, where there is no network to sniff.
  const loopback = parsed ? ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname) : false;
  if (parsed && parsed.protocol === 'http:' && !loopback) {
    throw new ConfigError(
      `Refusing to send credentials over plaintext HTTP to ${parsed.hostname}. ` +
        'Use https://, or point UMAMI_URL at localhost for local development.',
    );
  }

  const username = env.UMAMI_USERNAME?.trim() || undefined;
  const password = env.UMAMI_PASSWORD ?? undefined;
  const apiKey = env.UMAMI_API_KEY?.trim() || undefined;

  if (!oauthEnabled && !apiKey && !(username && password)) {
    throw new ConfigError(
      'No credentials found. Set UMAMI_USERNAME and UMAMI_PASSWORD (self-hosted), ' +
        'or UMAMI_API_KEY (Umami Cloud). ' +
        'Alternatively set UMAMI_MCP_OAUTH=true to run multi-tenant, where each user brings their own.',
    );
  }

  let oauth: OAuthConfig | undefined;
  if (oauthEnabled) {
    const issuer = (env.UMAMI_MCP_ISSUER ?? '').trim().replace(/\/+$/, '');
    if (!issuer) {
      throw new ConfigError(
        'UMAMI_MCP_OAUTH is on, so UMAMI_MCP_ISSUER must be the public HTTPS URL of this server ' +
          '(e.g. https://umami-mcp.example.com). Clients build their redirect back from it.',
      );
    }
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(issuerUrl.hostname)) {
      throw new ConfigError('UMAMI_MCP_ISSUER must be https (or localhost for development).');
    }
    const tokenKey = env.UMAMI_MCP_TOKEN_KEY ?? '';
    if (tokenKey.length < 16) {
      throw new ConfigError(
        'UMAMI_MCP_TOKEN_KEY must be set to at least 16 characters and kept stable. ' +
          'It encrypts user credentials inside access tokens; changing it invalidates every issued token. ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
      );
    }
    oauth = {
      enabled: true,
      issuer,
      tokenKey,
      ttlSeconds: int(env.UMAMI_MCP_TOKEN_TTL, 30 * 24 * 3600, 'UMAMI_MCP_TOKEN_TTL'),
      fixedUrl: rawUrl || undefined,
    };
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
    oauth,
  };
}

/** Human-readable summary for startup logs. Never includes secrets. */
export function describeConfig(c: Config): string {
  if (c.oauth?.enabled) {
    const scope = c.oauth.fixedUrl ? `pinned to ${c.oauth.fixedUrl}` : 'multi-tenant';
    return `OAuth mode, ${scope} (issuer=${c.oauth.issuer}, transport=${c.transport})`;
  }
  const auth = c.apiKey ? 'api-key' : `user:${c.username}`;
  const destructive = c.allowDestructive ? ' +destructive' : '';
  return `${c.url} (auth=${auth}, mode=${c.mode}${destructive}, transport=${c.transport})`;
}
