import { z } from 'zod';
import { defineTool } from './common.js';

export const adminTools = [
  defineTool({
    name: 'umami_list_users',
    title: 'List users',
    description: 'List Umami user accounts with their roles. Admin only.',
    tier: 'admin',
    schema: {
      query: z.string().optional().describe('Filter by username (substring match).'),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    },
    handler: async ({ client }, args) =>
      client.get('/api/admin/users', { query: args.query, page: args.page, pageSize: args.pageSize }),
  }),

  defineTool({
    name: 'umami_create_user',
    title: 'Create user',
    description:
      'Create a Umami user account. The password you supply is sent only to your own Umami instance. ' +
      'Prefer a generated password that the new user changes on first login.',
    tier: 'admin',
    schema: {
      username: z.string().min(1),
      password: z.string().min(8).describe('At least 8 characters.'),
      role: z.enum(['admin', 'user', 'view-only']).optional().describe('Default "user".'),
    },
    handler: async ({ client }, args) => {
      const created = await client.post<{ id?: string; username?: string; role?: string }>('/api/users', {
        username: args.username,
        password: args.password,
        role: args.role ?? 'user',
      });
      // Never echo the password back into the transcript.
      return { id: created?.id, username: created?.username, role: created?.role, created: true };
    },
  }),

  defineTool({
    name: 'umami_delete_user',
    title: 'Delete user',
    description:
      'PERMANENTLY DELETE a user account and the websites they own. Cannot be undone. ' +
      'Requires admin mode with destructive operations enabled.',
    tier: 'admin',
    destructive: true,
    schema: {
      userId: z.string().min(1).describe('User UUID from umami_list_users.'),
      confirmUsername: z.string().min(1).describe('Type the exact username to confirm.'),
    },
    handler: async ({ client }, args) => {
      const user = await client.get<{ username?: string }>(`/api/users/${encodeURIComponent(args.userId)}`);
      if (!user?.username) throw new Error(`User ${args.userId} not found.`);
      if (user.username !== args.confirmUsername) {
        throw new Error(
          `Refusing to delete: confirmUsername ${JSON.stringify(args.confirmUsername)} does not match ` +
            `the account's actual username ${JSON.stringify(user.username)}.`,
        );
      }
      await client.del(`/api/users/${encodeURIComponent(args.userId)}`);
      return { deleted: true, userId: args.userId, username: user.username };
    },
  }),

  defineTool({
    name: 'umami_list_teams',
    title: 'List teams',
    description: 'List teams and their members.',
    tier: 'read',
    schema: {
      query: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional(),
    },
    handler: async ({ client }, args) =>
      client.get('/api/teams', { query: args.query, page: args.page, pageSize: args.pageSize }),
  }),

  defineTool({
    name: 'umami_create_team',
    title: 'Create team',
    description: 'Create a team so websites can be shared between users.',
    tier: 'write',
    schema: { name: z.string().min(1).describe('Team display name.') },
    handler: async ({ client }, args) => client.post('/api/teams', { name: args.name }),
  }),

  defineTool({
    name: 'umami_whoami',
    title: 'Check connection',
    description:
      'Verify that this MCP server can reach the configured Umami instance and report which account it is ' +
      'authenticated as, plus the permission mode the server is running in. Good first call for diagnosing setup.',
    tier: 'read',
    schema: {},
    handler: async ({ client, config }) => {
      const user = await client.verify();
      return {
        instance: config.url,
        authenticatedAs: user.username,
        role: user.role,
        serverMode: config.mode,
        destructiveOperations: config.allowDestructive ? 'enabled' : 'disabled',
      };
    },
  }),
];
