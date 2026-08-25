import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { UmamiClient } from './client.js';
import { redactUnknown } from './redact.js';
import { buildServer } from './server.js';
import { OAuthProvider } from './oauth/router.js';
import { deriveKey, SealError } from './oauth/seal.js';

export interface HttpDeps {
  config: Config;
  log: (...args: unknown[]) => void;
}

async function readJsonBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startHttp({ config, log }: HttpDeps): Promise<http.Server> {
  const oauth = config.oauth?.enabled
    ? new OAuthProvider({
        issuer: config.oauth.issuer,
        key: deriveKey(config.oauth.tokenKey),
        fixedUrl: config.oauth.fixedUrl,
        tokenTtlSeconds: config.oauth.ttlSeconds,
        baseConfig: config,
      })
    : undefined;

  // Single-tenant mode keeps one long-lived server, as before.
  const shared = oauth ? undefined : buildServer(config);
  let sharedTransport: StreamableHTTPServerTransport | undefined;
  if (shared) {
    sharedTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await shared.server.connect(sharedTransport);
    log(`${shared.registered.length} tools available, ${shared.withheld.length} withheld by mode "${config.mode}"`);
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log('request failed:', redactUnknown(err));
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const base = config.oauth?.issuer ?? `http://${req.headers.host ?? 'localhost'}`;
    const url = new URL(req.url ?? '/', base);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          mode: oauth ? 'oauth' : config.mode,
          multiTenant: Boolean(oauth && !config.oauth?.fixedUrl),
        }),
      );
      return;
    }

    if (oauth && (await oauth.handle(req, res, url))) return;

    if (!url.pathname.startsWith('/mcp')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found; the MCP endpoint is /mcp' }));
      return;
    }

    if (!oauth) {
      const body = await readJsonBody(req).catch(() => undefined);
      await sharedTransport!.handleRequest(req, res, body);
      return;
    }

    // --- OAuth mode: authenticate, then serve this one caller only. ---
    let identity;
    try {
      identity = oauth.authenticate(req);
    } catch (err) {
      // RFC 9728: point unauthenticated clients at the metadata so they can
      // start the flow on their own.
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${config.oauth!.issuer}/.well-known/oauth-protected-resource"`,
      });
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          error_description: err instanceof SealError ? err.message : 'Authentication required.',
        }),
      );
      return;
    }

    // A per-request server, scoped to exactly this user's Umami. Nothing is
    // shared between callers -- not the client, not the token, not the tools.
    const scoped: Config = {
      ...config,
      url: identity.url,
      username: identity.username,
      password: identity.password,
      apiKey: identity.apiKey,
      mode: identity.mode,
      // Irreversible operations are never reachable over a hosted connection,
      // whatever the user consented to. A remote caller cannot be shown the
      // typed confirmation guard the local tools rely on.
      allowDestructive: false,
      oauth: undefined,
    };

    const built = buildServer(scoped, new UmamiClient(scoped));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await built.server.connect(transport);
      const body = await readJsonBody(req).catch(() => undefined);
      await transport.handleRequest(req, res, body);
    } finally {
      await transport.close().catch(() => {});
      await built.server.close().catch(() => {});
    }
  }

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  log(`ready on http://${config.host}:${config.port}/mcp`);

  if (oauth) {
    log(`OAuth issuer: ${config.oauth!.issuer}`);
    log(config.oauth!.fixedUrl ? `pinned to ${config.oauth!.fixedUrl}` : 'multi-tenant: users bring their own Umami');
  } else if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    log(
      `WARNING: bound to ${config.host} with no authentication. ` +
        'Anyone who can reach this port can use your Umami credentials. ' +
        'Bind to 127.0.0.1 and use an SSH tunnel, enable UMAMI_MCP_OAUTH, or front it with an authenticating proxy.',
    );
  }

  return server;
}
