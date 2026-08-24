import { z } from 'zod';
import { defineTool, websiteIdSchema } from './common.js';

export const websiteTools = [
  defineTool({
    name: 'umami_list_websites',
    title: 'List websites',
    description:
      'List the websites tracked by this Umami instance, with their UUIDs. ' +
      'Every analytics tool needs a websiteId, so this is usually the first call.',
    tier: 'read',
    schema: {
      query: z.string().optional().describe('Filter by name or domain (substring match).'),
      page: z.number().int().min(1).optional().describe('Page number, default 1.'),
      pageSize: z.number().int().min(1).max(200).optional().describe('Results per page, default 20.'),
    },
    handler: async ({ client }, args) =>
      client.get('/api/websites', { query: args.query, page: args.page, pageSize: args.pageSize }),
  }),

  defineTool({
    name: 'umami_get_website',
    title: 'Get website',
    description: 'Fetch a single website by UUID, including its domain, owner and creation date.',
    tier: 'read',
    schema: { ...websiteIdSchema },
    handler: async ({ client }, args) => client.get(`/api/websites/${encodeURIComponent(args.websiteId)}`),
  }),

  defineTool({
    name: 'umami_create_website',
    title: 'Create website',
    description:
      'Register a new website for tracking and return its UUID, which is the value to put in the ' +
      'data-website-id attribute of the Umami tracking script.',
    tier: 'write',
    schema: {
      name: z.string().min(1).describe('Display name shown in the Umami dashboard.'),
      domain: z
        .string()
        .min(1)
        .describe('Hostname to track, without scheme or trailing slash, e.g. "example.com".'),
      shareId: z.string().optional().describe('Optional slug to enable a public share URL.'),
      teamId: z.string().optional().describe('Optional team UUID to own this website.'),
    },
    handler: async ({ client, config }, args) =>
      client.post('/api/websites', {
        name: args.name,
        domain: args.domain,
        shareId: args.shareId,
        teamId: args.teamId ?? config.teamId,
      }),
  }),

  defineTool({
    name: 'umami_update_website',
    title: 'Update website',
    description: 'Change a website\'s name, domain or share slug. Only the fields you pass are modified.',
    tier: 'write',
    schema: {
      ...websiteIdSchema,
      name: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
      shareId: z.string().nullable().optional().describe('Set to null to disable public sharing.'),
    },
    handler: async ({ client }, args) => {
      const body: Record<string, unknown> = {};
      for (const k of ['name', 'domain', 'shareId'] as const) {
        if (args[k] !== undefined) body[k] = args[k];
      }
      if (Object.keys(body).length === 0) {
        throw new Error('Nothing to update: pass at least one of name, domain or shareId.');
      }
      return client.post(`/api/websites/${encodeURIComponent(args.websiteId)}`, body);
    },
  }),

  defineTool({
    name: 'umami_reset_website',
    title: 'Reset website data',
    description:
      'PERMANENTLY DELETE all collected analytics data for a website, keeping the website itself. ' +
      'This cannot be undone and there is no backup. Requires admin mode with destructive operations enabled.',
    tier: 'admin',
    destructive: true,
    schema: {
      ...websiteIdSchema,
      confirmDomain: z
        .string()
        .min(1)
        .describe('Type the website\'s exact domain to confirm. The call fails if it does not match.'),
    },
    handler: async ({ client }, args) => {
      const site = await client.get<{ domain?: string; name?: string }>(
        `/api/websites/${encodeURIComponent(args.websiteId)}`,
      );
      if (!site?.domain) throw new Error(`Website ${args.websiteId} not found.`);
      if (site.domain !== args.confirmDomain) {
        throw new Error(
          `Refusing to reset: confirmDomain ${JSON.stringify(args.confirmDomain)} does not match ` +
            `the website's actual domain ${JSON.stringify(site.domain)}.`,
        );
      }
      await client.post(`/api/websites/${encodeURIComponent(args.websiteId)}/reset`);
      return { reset: true, websiteId: args.websiteId, domain: site.domain };
    },
  }),

  defineTool({
    name: 'umami_delete_website',
    title: 'Delete website',
    description:
      'PERMANENTLY DELETE a website and every event ever recorded for it. This cannot be undone. ' +
      'Requires admin mode with destructive operations enabled.',
    tier: 'admin',
    destructive: true,
    schema: {
      ...websiteIdSchema,
      confirmDomain: z
        .string()
        .min(1)
        .describe('Type the website\'s exact domain to confirm. The call fails if it does not match.'),
    },
    handler: async ({ client }, args) => {
      const site = await client.get<{ domain?: string }>(`/api/websites/${encodeURIComponent(args.websiteId)}`);
      if (!site?.domain) throw new Error(`Website ${args.websiteId} not found.`);
      if (site.domain !== args.confirmDomain) {
        throw new Error(
          `Refusing to delete: confirmDomain ${JSON.stringify(args.confirmDomain)} does not match ` +
            `the website's actual domain ${JSON.stringify(site.domain)}.`,
        );
      }
      await client.del(`/api/websites/${encodeURIComponent(args.websiteId)}`);
      return { deleted: true, websiteId: args.websiteId, domain: site.domain };
    },
  }),

  defineTool({
    name: 'umami_get_tracking_snippet',
    title: 'Get tracking snippet',
    description:
      'Return the ready-to-paste HTML script tag that sends data to this Umami instance for a given website.',
    tier: 'read',
    schema: { ...websiteIdSchema },
    handler: async ({ client, config }, args) => {
      const site = await client.get<{ id: string; name?: string; domain?: string }>(
        `/api/websites/${encodeURIComponent(args.websiteId)}`,
      );
      return {
        websiteId: site.id,
        domain: site.domain,
        snippet: `<script defer src="${config.url}/script.js" data-website-id="${site.id}"></script>`,
        instructions: 'Paste this immediately before the closing </head> tag of every page you want tracked.',
      };
    },
  }),
];
