/**
 * Redirect URI validation, following RFC 8252 (OAuth 2.0 for Native Apps).
 *
 * The spec allows three shapes, and a server that accepts only the first two
 * silently locks out every desktop MCP client:
 *
 *   1. https://…                       web clients
 *   2. http://127.0.0.1:PORT/…         loopback, for local CLIs
 *   3. myapp://…                       private-use scheme, for native apps
 *
 * The third is how Cursor (cursor://anysphere.cursor-mcp/oauth/callback),
 * VS Code and most desktop clients receive the callback; there is no listening
 * web server to redirect to. Rejecting it is not a stricter security posture,
 * it just makes the server unusable from a desktop.
 *
 * What actually protects a private-use scheme is PKCE, not the URI: another
 * app on the machine can register the same scheme and intercept the code, but
 * cannot exchange it without the verifier. RFC 8252 §8.1 requires PKCE for
 * exactly this reason, and so does this server -- see requiresPkce below.
 */

export type RedirectKind = 'https' | 'loopback' | 'private-use';

/** Schemes that are never a legitimate redirect target. */
const DANGEROUS = new Set(['javascript:', 'data:', 'blob:', 'file:', 'vbscript:', 'about:']);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class RedirectUriError extends Error {}

export function classifyRedirectUri(raw: string): RedirectKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RedirectUriError(`Not a URL: ${raw}`);
  }

  const scheme = url.protocol.toLowerCase();

  if (DANGEROUS.has(scheme)) {
    throw new RedirectUriError(`Refusing ${scheme} as a redirect target: ${raw}`);
  }

  if (scheme === 'https:') return 'https';

  if (scheme === 'http:') {
    // Plaintext is only safe where the request never leaves the machine.
    if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return 'loopback';
    throw new RedirectUriError(
      `redirect_uri must use https, a loopback address, or a private-use scheme such as myapp://. Got: ${raw}`,
    );
  }

  // Anything else is a private-use scheme (cursor://, vscode://, com.example.app://).
  // A bare "scheme:" with nothing after it cannot receive a callback.
  if (!raw.slice(scheme.length).replace(/^\/+/, '')) {
    throw new RedirectUriError(`Private-use redirect_uri needs a path or host: ${raw}`);
  }
  return 'private-use';
}

/**
 * PKCE is mandatory for private-use schemes: the OS hands the callback to
 * whichever app claimed the scheme, so the authorization code alone is not a
 * secret. Loopback has the same weakness in principle and is treated the same.
 */
export function requiresPkce(kind: RedirectKind): boolean {
  return kind === 'private-use' || kind === 'loopback';
}
