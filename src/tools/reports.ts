import { z } from 'zod';
import { defineTool, periodSchema, resolveRange, websiteIdSchema } from './common.js';
import type { ToolContext } from './common.js';

/**
 * Umami v3's report endpoints share one envelope:
 *
 *   POST /api/reports/<type>
 *   { websiteId, type, filters: {}, parameters: { startDate, endDate, ... } }
 *
 * The dates live in `parameters` as ISO-8601 strings -- not in `filters`, and
 * not as the epoch milliseconds the rest of the API uses. Every shape below was
 * verified against a live Umami 3.3.1 instance.
 */

interface ReportArgs {
  websiteId: string;
  period?: string;
  startAt?: number;
  endAt?: number;
  filters?: Record<string, unknown>;
}

async function runReport(
  { client }: ToolContext,
  type: string,
  args: ReportArgs,
  parameters: Record<string, unknown>,
) {
  const { startAt, endAt } = resolveRange(args);
  const body = {
    websiteId: args.websiteId,
    type,
    filters: args.filters ?? {},
    parameters: {
      startDate: new Date(startAt).toISOString(),
      endDate: new Date(endAt).toISOString(),
      ...parameters,
    },
  };
  const data = await client.post(`/api/reports/${type}`, body);
  return { report: type, range: { startAt, endAt }, data };
}

const filtersSchema = {
  filters: z
    .record(z.any())
    .optional()
    .describe('Optional Umami filter object to narrow the report, e.g. {"country":"BD"}.'),
};

export const reportTools = [
  defineTool({
    name: 'umami_report_utm',
    title: 'UTM campaign report',
    description:
      'Breakdown of traffic by UTM parameters: source, medium, campaign, term and content. ' +
      'In Umami v3 UTM data lives here, not in the /metrics endpoint.',
    tier: 'read',
    schema: { ...websiteIdSchema, ...periodSchema, ...filtersSchema },
    handler: (ctx, a) => runReport(ctx, 'utm', a as ReportArgs, {}),
  }),

  defineTool({
    name: 'umami_report_funnel',
    title: 'Funnel report',
    description:
      'Step-by-step conversion funnel. Give an ordered list of steps; the report returns visitors reaching ' +
      'each step plus the drop-off between them.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      ...filtersSchema,
      steps: z
        .array(
          z.object({
            type: z.enum(['path', 'event']).describe('Match a page path or a custom event name.'),
            value: z.string().min(1).describe('The path (e.g. "/pricing") or event name.'),
          }),
        )
        .min(2)
        .describe('Ordered funnel steps, at least two.'),
      window: z.number().int().min(1).optional().describe('Conversion window in minutes, default 60.'),
    },
    handler: (ctx, a) =>
      runReport(ctx, 'funnel', a as ReportArgs, { steps: a.steps, window: a.window ?? 60 }),
  }),

  defineTool({
    name: 'umami_report_retention',
    title: 'Retention report',
    description:
      'Cohort retention: of the visitors first seen on a given day, how many returned on each subsequent day.',
    tier: 'read',
    schema: { ...websiteIdSchema, ...periodSchema, ...filtersSchema },
    handler: (ctx, a) => runReport(ctx, 'retention', a as ReportArgs, {}),
  }),

  defineTool({
    name: 'umami_report_journey',
    title: 'User journey report',
    description:
      'Most common ordered paths visitors take through the site, as sequences of pages with a count for each.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      ...filtersSchema,
      steps: z.number().int().min(2).max(10).optional().describe('Journey length in pages, default 5.'),
    },
    handler: (ctx, a) => runReport(ctx, 'journey', a as ReportArgs, { steps: a.steps ?? 5 }),
  }),

  defineTool({
    name: 'umami_report_goal',
    title: 'Goal report',
    description: 'Progress toward a single goal: how many visitors hit a given path or custom event.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      ...filtersSchema,
      type: z.enum(['path', 'event']).describe('Whether the goal is a page path or a custom event.'),
      value: z.string().min(1).describe('The path (e.g. "/thank-you") or event name.'),
      operator: z.string().optional().describe('Optional comparison operator supported by Umami.'),
    },
    handler: (ctx, a) =>
      runReport(ctx, 'goal', a as ReportArgs, { type: a.type, value: a.value, operator: a.operator }),
  }),

  defineTool({
    name: 'umami_report_revenue',
    title: 'Revenue report',
    description:
      'Revenue over time from events carrying a revenue property, broken down by country, region, referrer and channel. ' +
      'Requires revenue tracking to be set up in Umami.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      ...filtersSchema,
      currency: z.string().length(3).optional().describe('ISO 4217 currency code, default "USD".'),
    },
    handler: (ctx, a) => runReport(ctx, 'revenue', a as ReportArgs, { currency: a.currency ?? 'USD' }),
  }),

  defineTool({
    name: 'umami_report_attribution',
    title: 'Attribution report',
    description:
      'Credits conversions to acquisition channels -- referrer, paid ads and UTM parameters -- under either a ' +
      'first-click or last-click model.',
    tier: 'read',
    schema: {
      ...websiteIdSchema,
      ...periodSchema,
      ...filtersSchema,
      model: z.enum(['first-click', 'last-click']).describe('Attribution model.'),
      type: z.enum(['path', 'event']).describe('Whether the conversion is a page path or a custom event.'),
      step: z.string().min(1).describe('The converting path (e.g. "/checkout") or event name.'),
    },
    handler: (ctx, a) =>
      runReport(ctx, 'attribution', a as ReportArgs, { model: a.model, type: a.type, step: a.step }),
  }),
];
