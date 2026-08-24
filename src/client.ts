import type { Config } from './config.js';
import { redact, redactUnknown } from './redact.js';

/**
 * A thin, dependency-free client for the Umami HTTP API.
 *
 * Self-hosted Umami has no API keys: you POST credentials to /api/auth/login
 * and receive a bearer token. That token is held in memory only, never
 * written to disk, and refreshed automatically when the server rejects it.
 * Umami Cloud does issue API keys, which are sent as x-umami-api-key instead.
 */

export class UmamiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'UmamiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export class UmamiClient {
  private token?: string;
  private loginInFlight?: Promise<string>;

  constructor(private readonly config: Config) {}

  private get usesApiKey(): boolean {
    return Boolean(this.config.apiKey);
  }

  /** Authenticate and cache the bearer token. Concurrent callers share one login. */
  private async login(): Promise<string> {
    if (this.loginInFlight) return this.loginInFlight;

    this.loginInFlight = (async () => {
      const res = await this.raw('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: this.config.username,
          password: this.config.password,
        }),
      });

      if (!res.ok) {
        const detail = res.status === 401 ? 'check UMAMI_USERNAME and UMAMI_PASSWORD' : await this.errorBody(res);
        throw new UmamiError(`Login failed (HTTP ${res.status}): ${detail}`, res.status, '/api/auth/login');
      }

      const body = (await res.json()) as { token?: string };
      if (!body.token) {
        throw new UmamiError('Login succeeded but returned no token', res.status, '/api/auth/login');
      }
      this.token = body.token;
      return body.token;
    })();

    try {
      return await this.loginInFlight;
    } finally {
      this.loginInFlight = undefined;
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (this.usesApiKey) return { 'x-umami-api-key': this.config.apiKey! };
    const token = this.token ?? (await this.login());
    return { authorization: `Bearer ${token}` };
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      return await fetch(this.config.url + path, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new UmamiError(`Request to ${path} timed out after ${this.config.timeoutMs}ms`, undefined, path);
      }
      throw new UmamiError(`Request to ${path} failed: ${redactUnknown(err)}`, undefined, path);
    } finally {
      clearTimeout(timer);
    }
  }

  private async errorBody(res: Response): Promise<string> {
    let text: string;
    try {
      text = await res.text();
    } catch {
      return res.statusText || 'no response body';
    }
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
      if (msg) return redact(msg);
    } catch {
      /* not JSON; fall through */
    }
    return redact(text.slice(0, 400)) || res.statusText;
  }

  /** Perform an authenticated API call, retrying once if the token expired. */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const qs = buildQuery(opts.query);
    const fullPath = path + qs;

    const attempt = async (): Promise<Response> => {
      const headers: Record<string, string> = { ...(await this.authHeaders()), accept: 'application/json' };
      const init: RequestInit = { method, headers };
      if (opts.body !== undefined) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      return this.raw(fullPath, init);
    };

    let res = await attempt();

    // A cached token can expire mid-session; re-login once and retry.
    if (res.status === 401 && !this.usesApiKey) {
      this.token = undefined;
      res = await attempt();
    }

    if (!res.ok) {
      throw new UmamiError(
        `Umami API ${method} ${path} failed (HTTP ${res.status}): ${await this.errorBody(res)}`,
        res.status,
        path,
      );
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UmamiError(`Umami API ${method} ${path} returned malformed JSON`, res.status, path);
    }
  }

  get<T = unknown>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, query?: Query) {
    return this.request<T>('POST', path, { body, query });
  }
  del<T = unknown>(path: string, query?: Query) {
    return this.request<T>('DELETE', path, { query });
  }

  /** Verify credentials and reachability. Returns the authenticated user. */
  async verify(): Promise<{ username?: string; role?: string; isAdmin?: boolean }> {
    const me = await this.get<{ user?: { username?: string; role?: string; isAdmin?: boolean } }>('/api/me');
    return me.user ?? {};
  }
}

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
