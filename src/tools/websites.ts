import { z } from 'zod';
import { defineTool, websiteIdSchema } from './common.js';

interface Website {
  id: string;
  name?: string;
  domain?: string;
  teamId?: string | null;
  teamName?: string;
  [k: string]: unknown;
}
interface Paged {
  data?: Website[];
  count?: number;
  [k: string]: unknown;
}
const emptyPage = (): Paged => ({ data: [], count: 0 });

export const websiteTools = [
  defineTool({
    name: 'umami_list_websites',
    title: 'List websites',
    description:
      'List every website this account can reach, with their UUIDs. ' +
      'Covers both personally-owned websites and those owned by teams the account belongs to. ' +
      'Every analytics tool needs a websiteId, so this is usually the first call.',
    tier: 'read',
    schema: {
      query: z.string().optional().describe('Filter by name or domain (substring match).'),
      teamId: z.string().optional().describe('Restrict to a single team\'s websites.'),
      page: z.number().int().min(1).optional().describe('Page number, default 1.'),
      pageSize: z.number().int().min(1).max(200).optional().describe('Results per page, default 20.'),
    },
    handler: async ({ client, config }, args) => {
      const q = { query: args.query, page: args.page, pageSize: args.pageSize };

      const scopedTeam = args.teamId ?? config.teamId;
      if (scopedTeam) {
        const r = await client.get<Paged>(`/api/teams/${encodeURIComponent(scopedTeam)}/websites`, q);
        return { ...r, scope: `team:${scopedTeam}` };
      }

      // Umami scopes /api/websites to websites the account owns personally.
      // Websites owned by a team are only reachable through the team endpoint,
      // so an account that works purely through team membership -- which is the
      // recommended setup for a service account -- would otherwise see nothing.
      const own = await client.get<Paged>('/api/websites', q).catch(() => emptyPage());

      let teams: Paged = emptyPage();
      try {
        teams = await client.get<Paged>('/api/me/teams');
      } catch {
        /* no team access; personal websites are the whole picture */
      }

      const seen = new Set((own.data ?? []).map((w) => w.id));
      const merged: Website[] = [...(own.data ?? [])];
      // `count` must stay the number of websites that EXIST, not the number
      // returned by this page. Conflating them makes a model report
      // "you have 4 websites" when it has merely fetched four of twenty-one.
      let total = own.count ?? own.data?.length ?? 0;

      for (const team of teams.data ?? []) {
        const teamId = (team as any).id ?? (team as any).teamId;
        if (!teamId) continue;
        try {
          const tw = await client.get<Paged>(`/api/teams/${encodeURIComponent(teamId)}/websites`, q);
          total += tw.count ?? tw.data?.length ?? 0;
          for (const w of tw.data ?? []) {
            if (seen.has(w.id)) continue;
            seen.add(w.id);
            merged.push({ ...w, teamName: (team as any).name ?? undefined });
          }
        } catch {
          /* a team we cannot read is simply skipped */
        }
      }

      return {
        data: merged,
        count: total,
        returned: merged.length,
        scope: 'personal+teams',
        ...(merged.length < total
          ? { note: 'More websites exist than were returned. Paging applies per scope; raise pageSize or pass teamId to narrow.' }
          : {}),
      };
    },
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
