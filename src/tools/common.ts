import { z } from 'zod';
import type { UmamiClient } from '../client.js';
import type { Config, Mode } from '../config.js';

/**
 * Tools declare the privilege they need. The server registers only the tools
 * the operator has enabled, so a tool the operator did not permit is not
 * merely refused at call time -- it is never advertised to the model at all,
 * and therefore cannot be invoked by a prompt-injected instruction.
 */
export type Tier = 'read' | 'write' | 'admin';

export interface ToolContext {
  client: UmamiClient;
  config: Config;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  tier: Tier;
  /** Irreversible: deleting a site, wiping its data, removing a user. */
  destructive?: boolean;
  schema: z.ZodRawShape;
  handler: (ctx: ToolContext, args: Record<string, any>) => Promise<unknown>;
}

export function defineTool(def: ToolDef): ToolDef {
  return def;
}

const RANK: Record<Mode, number> = { read: 0, write: 1, admin: 2 };

/** Is `tool` permitted under the operator's configuration? */
export function isAllowed(tool: ToolDef, config: Config): boolean {
  if (RANK[tool.tier] > RANK[config.mode]) return false;
  if (tool.destructive && !config.allowDestructive) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Date handling
 *
 * Umami expects epoch milliseconds. Models are far better at "last 7
 * days" than at arithmetic on timestamps, and a model that miscalculates
 * an epoch silently returns data for the wrong period. Accepting a
 * shorthand removes that whole class of error.
 * ------------------------------------------------------------------ */

const RELATIVE = /^(\d+)(h|d|w|m|y)$/i;
const UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000, // 30d
  y: 31_536_000_000, // 365d
};

export const periodSchema = {
  period: z
    .string()
    .optional()
    .describe(
      'Relative time range: "24h", "7d", "30d", "12m", or "today"/"yesterday". ' +
        'Defaults to "7d". Ignored if startAt/endAt are given.',
    ),
  startAt: z.number().int().optional().describe('Range start, epoch milliseconds. Overrides period.'),
  endAt: z.number().int().optional().describe('Range end, epoch milliseconds. Overrides period.'),
};

export interface Range {
  startAt: number;
  endAt: number;
}

export function resolveRange(args: { period?: string; startAt?: number; endAt?: number }, now = Date.now()): Range {
  if (args.startAt !== undefined && args.endAt !== undefined) {
    if (args.endAt < args.startAt) throw new Error('endAt must be greater than or equal to startAt');
    return { startAt: args.startAt, endAt: args.endAt };
  }

  const period = (args.period ?? '7d').trim().toLowerCase();

  if (period === 'today') {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return { startAt: d.getTime(), endAt: now };
  }
  if (period === 'yesterday') {
    const end = new Date(now);
    end.setUTCHours(0, 0, 0, 0);
    return { startAt: end.getTime() - UNIT_MS.d, endAt: end.getTime() };
  }

  const m = RELATIVE.exec(period);
  if (!m) {
    throw new Error(
      `Unrecognised period ${JSON.stringify(args.period)}. Use e.g. "24h", "7d", "30d", "12m", "today", "yesterday", ` +
        'or pass explicit startAt/endAt epoch milliseconds.',
    );
  }
  const span = Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
  return { startAt: now - span, endAt: now };
}

/** Metric dimensions accepted by Umami v3's /metrics endpoint. */
export const METRIC_TYPES = [
  'path',
  'title',
  'referrer',
  'query',
  'browser',
  'os',
  'device',
  'screen',
  'country',
  'region',
  'city',
  'language',
  'hostname',
  'event',
  'tag',
  'channel',
] as const;

export const websiteIdSchema = {
  websiteId: z.string().min(1).describe('Umami website UUID. Use umami_list_websites to find it.'),
};
