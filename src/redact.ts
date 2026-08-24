/**
 * Defence in depth: an MCP server hands its output straight to a language
 * model, and from there often into a chat transcript. A stack trace or an
 * echoed request body that happens to contain a password would leak it into
 * places it can never be recalled from. Every string leaving this server is
 * scrubbed first.
 */

let secrets: string[] = [];

/** Register values that must never appear in output. Call once at startup. */
export function registerSecrets(...values: (string | undefined)[]): void {
  for (const v of values) {
    // Very short values would cause absurd over-redaction of ordinary text.
    if (v && v.length >= 6) secrets.push(v);
  }
  // Longest first, so an overlapping secret is fully masked.
  secrets.sort((a, b) => b.length - a.length);
}

/** Test seam. */
export function _resetSecrets(): void {
  secrets = [];
}

const PATTERNS: [RegExp, string][] = [
  // JSON fields commonly carrying credentials.
  [/("(?:password|token|apiKey|api_key|secret|authorization)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"'],
  // Authorization headers in any casing.
  [/(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  // Bare JWTs.
  [/\beyJ[A-Za-z0-9._-]{20,}/g, '[redacted-jwt]'],
];

export function redact(input: string): string {
  let out = input;
  for (const s of secrets) {
    // Literal replacement; secrets are not regexes.
    out = out.split(s).join('[redacted]');
  }
  for (const [re, sub] of PATTERNS) out = out.replace(re, sub);
  return out;
}

/** Redact anything, including Error objects and nested structures. */
export function redactUnknown(value: unknown): string {
  if (value instanceof Error) return redact(value.message);
  if (typeof value === 'string') return redact(value);
  try {
    return redact(JSON.stringify(value));
  } catch {
    return redact(String(value));
  }
}
