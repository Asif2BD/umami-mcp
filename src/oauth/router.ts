import type { IncomingMessage, ServerResponse } from 'node:http';
import { UmamiClient } from '../client.js';
import type { Config, Mode } from '../config.js';
import { redactUnknown } from '../redact.js';
import { consentPage, errorPage } from './consent.js';
import { MemoryStore } from './store.js';
import { seal, unseal, verifyPkce, safeEqual, type SealedIdentity, SealError } from './seal.js';
import { assertPublicTarget, BlockedTargetError } from './ssrf.js';

export interface OAuthOptions {
  /** Public base URL of this server, e.g. https://umami-mcp.example.com */
  issuer: string;
  key: Buffer;
  /** Pin every connection to one Umami instance; omit for multi-tenant. */
  fixedUrl?: string;
  tokenTtlSeconds: number;
  baseConfig: Config;
}

const MODES: Mode[] = ['read', 'write', 'admin'];

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function html(res: ServerResponse, status: number, body: string, redirectUri?: string): void {
  // form-action must name the redirect target as well as 'self'.
  //
  // Browsers enforce form-action across the redirect chain that FOLLOWS a form
  // submission, not just the initial POST. With a bare 'self', the consent form
  // posts fine and the server answers 302 to the client's redirect_uri -- and
  // the browser then silently blocks that navigation. The visible symptom is a
  // Connect button that does nothing at all, which is a miserable thing to debug.
  let formAction = "'self'";
  if (redirectUri) {
    try {
      formAction += ` ${new URL(redirectUri).origin}`;
    } catch {
      /* unparseable redirect_uri is rejected elsewhere */
    }
  }
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}`,
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const type = req.headers['content-type'] ?? '';
  const body = await readBody(req);
  if (type.includes('application/json')) {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    return params;
  }
  return new URLSearchParams(body);
}

export class OAuthProvider {
  readonly store = new MemoryStore();

  constructor(private readonly o: OAuthOptions) {}

  /** Validate an Authorization header and return the caller's identity. */
  authenticate(req: IncomingMessage): SealedIdentity {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) throw new SealError('Missing bearer token.');
    return unseal(match[1].trim(), this.o.key);
  }

  /** Returns true when the request was an OAuth endpoint and has been handled. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;

    if (p === '/.well-known/oauth-authorization-server') {
      json(res, 200, {
        issuer: this.o.issuer,
        authorization_endpoint: `${this.o.issuer}/authorize`,
        token_endpoint: `${this.o.issuer}/token`,
        registration_endpoint: `${this.o.issuer}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        scopes_supported: ['umami:read', 'umami:write', 'umami:admin'],
      });
      return true;
    }

    if (p === '/.well-known/oauth-protected-resource') {
      json(res, 200, {
        resource: this.o.issuer,
        authorization_servers: [this.o.issuer],
        scopes_supported: ['umami:read', 'umami:write', 'umami:admin'],
      });
      return true;
    }

    if (p === '/register' && req.method === 'POST') {
      await this.register(req, res);
      return true;
    }

    if (p === '/authorize') {
      if (req.method === 'GET') return this.showConsent(res, url), true;
      if (req.method === 'POST') return await this.grant(req, res), true;
    }

    if (p === '/token' && req.method === 'POST') {
      await this.token(req, res);
      return true;
    }

    return false;
  }

  private async register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: 'invalid_client_metadata', error_description: 'Body must be JSON.' });
      return;
    }
    const uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
    if (uris.length === 0) {
      json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' });
      return;
    }
    for (const u of uris) {
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        json(res, 400, { error: 'invalid_redirect_uri', error_description: `Not a URL: ${u}` });
        return;
      }
      // Loopback may be plaintext; anything else must be HTTPS, or the code
      // can be intercepted in transit.
      const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !loopback) {
        json(res, 400, {
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri must use https (or be loopback): ${u}`,
        });
        return;
      }
    }
    const client = this.store.registerClient(uris, typeof body.client_name === 'string' ? body.client_name : undefined);
    json(res, 201, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });
  }

  private showConsent(res: ServerResponse, url: URL, error?: string): void {
    const q = url.searchParams;
    const clientId = q.get('client_id') ?? '';
    const redirectUri = q.get('redirect_uri') ?? '';
    const method = q.get('code_challenge_method') ?? 'S256';

    if (!clientId || !redirectUri) {
      html(res, 400, errorPage('Invalid request', 'client_id and redirect_uri are required.'));
      return;
    }
    if (q.get('code_challenge') && method !== 'S256') {
      html(res, 400, errorPage('Unsupported PKCE method', 'Only S256 is accepted.'));
      return;
    }

    const client = this.store.getClient(clientId);
    // An unregistered client_id is allowed (operators may configure a static
    // one), but a registered client's redirect_uri must match exactly.
    if (client && !client.redirectUris.includes(redirectUri)) {
      html(res, 400, errorPage('Invalid redirect URI', 'It does not match this client registration.'));
      return;
    }

    html(
      res,
      200,
      consentPage({
        action: url.pathname,
        clientName: client?.name,
        fixedUrl: this.o.fixedUrl,
        error,
        hiddenFields: {
          client_id: clientId,
          redirect_uri: redirectUri,
          state: q.get('state') ?? '',
          code_challenge: q.get('code_challenge') ?? '',
          code_challenge_method: method,
          scope: q.get('scope') ?? '',
        },
      }),
      redirectUri,
    );
  }

  /** Consent submitted: verify the credentials for real, then mint a code. */
  private async grant(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let form: URLSearchParams;
    try {
      form = await readForm(req);
    } catch (err) {
      html(res, 400, errorPage('Invalid request', redactUnknown(err)));
      return;
    }

    const clientId = form.get('client_id') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    const umamiUrl = (this.o.fixedUrl ?? form.get('umami_url') ?? '').trim().replace(/\/+$/, '');
    const username = (form.get('umami_username') ?? '').trim();
    const password = form.get('umami_password') ?? '';
    const mode = (form.get('mode') ?? 'read') as Mode;

    const rerender = (message: string) => {
      const back = new URL(`${this.o.issuer}/authorize`);
      for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope']) {
        const v = form.get(k);
        if (v) back.searchParams.set(k, v);
      }
      this.showConsent(res, back, message);
    };

    if (!clientId || !redirectUri) return rerender('Missing client_id or redirect_uri.');
    if (!MODES.includes(mode)) return rerender('Invalid permission selection.');
    if (!umamiUrl || !username || !password) return rerender('All fields are required.');

    // When the operator pinned a single instance, that URL is trusted and the
    // user never chose it. Otherwise a stranger picked this address, so it must
    // be proven to be a public one before we send credentials to it.
    if (!this.o.fixedUrl) {
      try {
        await assertPublicTarget(umamiUrl);
      } catch (err) {
        if (err instanceof BlockedTargetError) return rerender(err.message);
        return rerender('That address could not be verified.');
      }
    } else {
      try {
        const parsed = new URL(umamiUrl);
        const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        if (parsed.protocol !== 'https:' && !loopback) {
          return rerender('Refusing to send your password over plaintext HTTP. Use an https:// URL.');
        }
      } catch {
        return rerender('That does not look like a valid URL.');
      }
    }

    // Prove the credentials work before issuing anything, so a typo fails here
    // rather than silently producing a token that never works.
    const probe = new UmamiClient({ ...this.o.baseConfig, url: umamiUrl, username, password, apiKey: undefined });
    try {
      await probe.verify();
    } catch (err) {
      return rerender(`Umami rejected those credentials: ${redactUnknown(err)}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const identity: SealedIdentity = {
      url: umamiUrl,
      username,
      password,
      mode,
      iat: now,
      exp: now + this.o.tokenTtlSeconds,
    };

    const code = this.store.createCode({
      clientId,
      redirectUri,
      codeChallenge: form.get('code_challenge') || undefined,
      codeChallengeMethod: form.get('code_challenge_method') || undefined,
      scope: form.get('scope') || undefined,
      state: form.get('state') || undefined,
      token: seal(identity, this.o.key),
    });

    const location = new URL(redirectUri);
    location.searchParams.set('code', code);
    const state = form.get('state');
    if (state) location.searchParams.set('state', state);
    res.writeHead(302, { location: location.toString(), 'cache-control': 'no-store' });
    res.end();
  }

  private async token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let form: URLSearchParams;
    try {
      form = await readForm(req);
    } catch {
      json(res, 400, { error: 'invalid_request' });
      return;
    }

    if (form.get('grant_type') !== 'authorization_code') {
      json(res, 400, { error: 'unsupported_grant_type', error_description: 'Only authorization_code is supported.' });
      return;
    }

    const code = form.get('code') ?? '';
    const pending = this.store.consumeCode(code);
    if (!pending) {
      json(res, 400, { error: 'invalid_grant', error_description: 'Code is unknown, used, or expired.' });
      return;
    }

    if (!safeEqual(pending.clientId, form.get('client_id') ?? '')) {
      json(res, 400, { error: 'invalid_grant', error_description: 'Code was issued to a different client.' });
      return;
    }
    if (!safeEqual(pending.redirectUri, form.get('redirect_uri') ?? '')) {
      json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request.' });
      return;
    }

    const client = this.store.getClient(pending.clientId);
    if (client?.clientSecret) {
      const presented = form.get('client_secret') ?? '';
      if (!safeEqual(client.clientSecret, presented)) {
        json(res, 401, { error: 'invalid_client' });
        return;
      }
    }

    if (pending.codeChallenge) {
      const verifier = form.get('code_verifier') ?? '';
      if (!verifier || !verifyPkce(verifier, pending.codeChallenge, pending.codeChallengeMethod ?? 'S256')) {
        json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed.' });
        return;
      }
    }

    json(res, 200, {
      access_token: pending.token,
      token_type: 'Bearer',
      expires_in: this.o.tokenTtlSeconds,
      scope: pending.scope ?? 'umami:read',
    });
  }
}
