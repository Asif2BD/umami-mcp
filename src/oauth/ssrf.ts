import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guard against using the consent form as a server-side request forger.
 *
 * In multi-tenant mode any stranger can type a URL here and the server will
 * dutifully POST credentials to it and report what came back. Left unchecked
 * that turns a public form into a probe of the host's own network: an attacker
 * submits http://127.0.0.1:18007 or https://10.0.0.5 and reads the difference
 * between "connection refused" and "credentials rejected" to enumerate internal
 * services. The single-tenant path is unaffected -- there the operator chooses
 * the URL, and pointing at localhost is a legitimate development setup.
 */

export class BlockedTargetError extends Error {}

/** Reserved, private, loopback and link-local IPv4 space. */
function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0) return true;                       // "this network"
  if (a === 10) return true;                      // private
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;          // protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                      // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  // IPv4-mapped (::ffff:10.0.0.1) must be judged on the embedded address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateV4(mapped[1]);
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true; // not an IP literal we understand
}

const BLOCKED_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'metadata.google.internal']);

/**
 * Throws unless `raw` is an https URL whose hostname resolves to a public
 * address. Resolution matters: a hostname an attacker controls can point at
 * 127.0.0.1 just as easily as an IP literal can.
 */
export async function assertPublicTarget(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedTargetError('That does not look like a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new BlockedTargetError('Only https:// addresses are accepted here, so your password is never sent in the clear.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedTargetError('That address is not reachable from this server.');
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new BlockedTargetError('That address is not reachable from this server.');
    }
    return;
  }

  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new BlockedTargetError('That hostname could not be resolved.');
  }
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    // If ANY answer is private, refuse: a round-robin with one internal entry
    // would otherwise be reachable on a retry.
    throw new BlockedTargetError('That address is not reachable from this server.');
  }
}
