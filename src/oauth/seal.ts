import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Access tokens are sealed credential envelopes, not database keys.
 *
 * A multi-tenant hosted deployment must let each user reach their own Umami
 * with their own login. The obvious way is a sessions table mapping token to
 * credentials -- which means the host is now storing a pile of other people's
 * analytics passwords, and is one backup leak away from a very bad day.
 *
 * Instead the credentials travel inside the token itself, encrypted with a key
 * only the server holds. The server keeps no session state at all: it decrypts
 * on each request, uses the credentials, and forgets them.
 *
 * Trade-off, stated plainly: anyone holding the sealing key can decrypt any
 * token they capture. The key must be persisted out of band (UMAMI_MCP_TOKEN_KEY)
 * and treated as the most sensitive value in the deployment. Rotating it
 * invalidates every issued token, which is the intended blast-radius control.
 */

const ALG = 'aes-256-gcm';
const VERSION = 'v1';

export interface SealedIdentity {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  /** Permission tier the user consented to. */
  mode: 'read' | 'write' | 'admin';
  /** Unix seconds. */
  iat: number;
  exp: number;
}

export class SealError extends Error {}

/** Derive a 32-byte key from arbitrary operator-supplied material. */
export function deriveKey(material: string): Buffer {
  if (material.length < 16) {
    throw new SealError('UMAMI_MCP_TOKEN_KEY must be at least 16 characters; 32+ random bytes is better.');
  }
  return createHash('sha256').update(material, 'utf8').digest();
}

export function generateKey(): string {
  return randomBytes(32).toString('base64url');
}

export function seal(identity: SealedIdentity, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(identity), 'utf8');
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), body.toString('base64url'), tag.toString('base64url')].join('.');
}

export function unseal(token: string, key: Buffer): SealedIdentity {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SealError('Malformed token.');
  let identity: SealedIdentity;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const body = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    identity = JSON.parse(plaintext.toString('utf8')) as SealedIdentity;
  } catch {
    // Never distinguish "wrong key" from "tampered" from "malformed":
    // that distinction is a decryption oracle.
    throw new SealError('Invalid or expired token.');
  }
  if (typeof identity.exp !== 'number' || identity.exp * 1000 < Date.now()) {
    throw new SealError('Invalid or expired token.');
  }
  return identity;
}

/** Constant-time compare for client secrets and PKCE verifiers. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** RFC 7636 S256 challenge verification. */
export function verifyPkce(verifier: string, challenge: string, method = 'S256'): boolean {
  if (method === 'plain') return safeEqual(verifier, challenge);
  if (method !== 'S256') return false;
  const computed = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return safeEqual(computed, challenge);
}
