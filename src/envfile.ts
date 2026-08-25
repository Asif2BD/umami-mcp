import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Optional env-file loading.
 *
 * MCP clients configure servers by embedding environment variables in a JSON
 * config file -- ~/.claude.json, mcp.json, and friends. Those files are widely
 * readable, are routinely pasted into issues and screen-shares, and several
 * clients sync them between machines. Self-hosted Umami has no API keys, so the
 * value being embedded is a real account password.
 *
 * Loading credentials from a file the operator controls means the client config
 * can name the server and nothing else.
 *
 * Precedence: real environment variables always win, so an explicit
 * `UMAMI_PASSWORD=...` in the client config still overrides the file.
 */

export interface EnvFileResult {
  path?: string;
  loaded: number;
  warnings: string[];
}

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes; leave inner content untouched so
    // passwords containing '#' or spaces survive intact.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function candidatePaths(env: NodeJS.ProcessEnv): string[] {
  if (env.UMAMI_MCP_ENV_FILE) return [env.UMAMI_MCP_ENV_FILE];
  return [
    join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'umami-mcp', 'env'),
    join(process.cwd(), '.env'),
  ];
}

export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): EnvFileResult {
  const explicit = Boolean(env.UMAMI_MCP_ENV_FILE);
  const warnings: string[] = [];

  for (const path of candidatePaths(env)) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      // An explicitly named file that cannot be read is an operator error worth
      // surfacing; the implicit locations are just absent.
      if (explicit) warnings.push(`UMAMI_MCP_ENV_FILE is set to ${path} but it could not be read.`);
      continue;
    }

    try {
      const mode = statSync(path).mode & 0o077;
      if (mode !== 0) {
        warnings.push(
          `${path} is readable by other users (mode ${(statSync(path).mode & 0o777).toString(8)}). ` +
            `Run: chmod 600 ${path}`,
        );
      }
    } catch {
      /* stat failing is not fatal */
    }

    let loaded = 0;
    for (const [k, v] of Object.entries(parse(text))) {
      // Real environment wins.
      if (env[k] === undefined) {
        env[k] = v;
        loaded++;
      }
    }
    return { path, loaded, warnings };
  }

  return { loaded: 0, warnings };
}
