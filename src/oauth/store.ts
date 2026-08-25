import { randomBytes } from 'node:crypto';

/**
 * Authorization codes and dynamically-registered clients live in memory only.
 *
 * Codes are single-use and expire in a minute, so losing them on restart costs
 * a user one retry. Registered clients are also in memory: a restart forces
 * re-registration, which MCP clients handle automatically. Nothing here is
 * worth the operational weight of a database.
 */

export interface PendingAuth {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  scope?: string;
  state?: string;
  /** Sealed identity, minted at consent time. */
  token: string;
  expiresAt: number;
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  name?: string;
  createdAt: number;
}

const CODE_TTL_MS = 60_000;

export class MemoryStore {
  private codes = new Map<string, PendingAuth>();
  private clients = new Map<string, RegisteredClient>();

  createCode(auth: Omit<PendingAuth, 'expiresAt'>): string {
    this.sweep();
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { ...auth, expiresAt: Date.now() + CODE_TTL_MS });
    return code;
  }

  /** Codes are single-use: consuming one removes it, replay included. */
  consumeCode(code: string): PendingAuth | undefined {
    this.sweep();
    const found = this.codes.get(code);
    if (!found) return undefined;
    this.codes.delete(code);
    if (found.expiresAt < Date.now()) return undefined;
    return found;
  }

  registerClient(redirectUris: string[], name?: string): RegisteredClient {
    const client: RegisteredClient = {
      clientId: randomBytes(16).toString('base64url'),
      clientSecret: randomBytes(32).toString('base64url'),
      redirectUris,
      name,
      createdAt: Date.now(),
    };
    this.clients.set(client.clientId, client);
    return client;
  }

  getClient(clientId: string): RegisteredClient | undefined {
    return this.clients.get(clientId);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, auth] of this.codes) {
      if (auth.expiresAt < now) this.codes.delete(code);
    }
  }

  get stats() {
    return { codes: this.codes.size, clients: this.clients.size };
  }
}
