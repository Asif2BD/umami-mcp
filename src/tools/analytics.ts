import { z } from 'zod';
import { defineTool, periodSchema, resolveRange, websiteIdSchema, METRIC_TYPES } from './common.js';

export const analyticsTools = [
  defineTool({
    name: 'umami_get_stats',
    title: 'Get summary stats',
    description:
      'Headline totals for a website over a period: pageviews, visitors, visits, bounces and total time on site. ' +
      'The response also includes a "comparison" block for the equally-long preceding period, so you can report trends.',
    tier: 'read',
    schema: { ...websiteIdSchema, ...periodSchema },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await client.get<Record<string, any>>(
        `/api/websites/${encodeURIComponent(args.websiteId)}/stats`,
        { startAt, endAt },
      );
      return { range: { startAt, endAt }, ...data };
    },
  }),

  defineTool({
    name: 'umami_get_pageviews',
    title: 'Get pageview time series',
    description:
      'Pageviews and sessions bucketed over time, for charting traffic. Returns two parallel series.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      unit: z.enum(['hour', 'day', 'month', 'year']).optional().describe('Bucket size, default "day".'),
      timezone: z.string().optional().describe('IANA timezone for bucket boundaries, e.g. "Asia/Dhaka". Default UTC.'),
    },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await client.get(`/api/websites/${encodeURIComponent(args.websiteId)}/pageviews`, {
        startAt,
        endAt,
        unit: args.unit ?? 'day',
        timezone: args.timezone ?? 'UTC',
      });
      return { range: { startAt, endAt }, unit: args.unit ?? 'day', ...(data as object) };
    },
  }),

  defineTool({
    name: 'umami_get_metrics',
    title: 'Get metric breakdown',
    description:
      'Top values for one dimension, ranked by visitor count -- top pages, referrers, countries, browsers and so on. ' +
      'Returns [{x, y}] where x is the value and y is the count. ' +
      'Note: Umami v3 renamed the v2 "url" type to "path" and "host" to "hostname".',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      type: z.enum(METRIC_TYPES).describe('Dimension to break down by.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum rows, default 20.'),
    },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await client.get(`/api/websites/${encodeURIComponent(args.websiteId)}/metrics`, {
        startAt,
        endAt,
        type: args.type,
        limit: args.limit ?? 20,
      });
      return { range: { startAt, endAt }, type: args.type, data };
    },
  }),

  defineTool({
    name: 'umami_get_active_visitors',
    title: 'Get active visitors',
    description: 'Number of visitors active on the site in the last few minutes. Cheap; good for a live check.',
    tier: 'read',
    schema: { ...websiteIdSchema },
    handler: async ({ client }, args) =>
      client.get(`/api/websites/${encodeURIComponent(args.websiteId)}/active`),
  }),

  defineTool({
    name: 'umami_get_realtime',
    title: 'Get realtime activity',
    description:
      'Live snapshot of current activity: recent events with country, URL, browser and device, plus rollups ' +
      'by country, URL and referrer. Use this to answer "what is happening on the site right now".',
    tier: 'read',
    schema: { websiteId: websiteIdSchema.websiteId },
    handler: async ({ client }, args) => client.get(`/api/realtime/${encodeURIComponent(args.websiteId)}`),
  }),

  defineTool({
    name: 'umami_get_event_stats',
    title: 'Get custom event stats',
    description:
      'Totals for custom tracked events over a period: event count, unique event names, visitors and visits, ' +
      'with a comparison against the preceding period.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      unit: z.enum(['hour', 'day', 'month', 'year']).optional().describe('Bucket size, default "day".'),
      timezone: z.string().optional().describe('IANA timezone, default UTC.'),
    },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      const data = await client.get(`/api/websites/${encodeURIComponent(args.websiteId)}/events/stats`, {
        startAt,
        endAt,
        unit: args.unit ?? 'day',
        timezone: args.timezone ?? 'UTC',
      });
      return { range: { startAt, endAt }, ...(data as object) };
    },
  }),

  defineTool({
    name: 'umami_list_sessions',
    title: 'List sessions',
    description:
      'Individual visitor sessions with browser, OS, device, country and region. ' +
      'Useful for drilling into who visited rather than aggregate counts.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional().describe('Default 20.'),
    },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      return client.get(`/api/websites/${encodeURIComponent(args.websiteId)}/sessions`, {
        startAt,
        endAt,
        page: args.page,
        pageSize: args.pageSize,
      });
    },
  }),

  defineTool({
    name: 'umami_get_session_activity',
    title: 'Get session activity',
    description: 'The ordered sequence of pageviews and events for one visitor session -- their path through the site.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      sessionId: z.string().min(1).describe('Session UUID from umami_list_sessions.'),
      ...periodSchema,
    },
    handler: async ({ client }, args) => {
      const { startAt, endAt } = resolveRange(args);
      return client.get(
        `/api/websites/${encodeURIComponent(args.websiteId)}/sessions/${encodeURIComponent(args.sessionId)}/activity`,
        { startAt, endAt },
      );
    },
  }),
];
