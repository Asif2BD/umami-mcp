import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UmamiClient } from './client.js';
import type { Config } from './config.js';
import { redactUnknown } from './redact.js';
import { allTools, isAllowed, type ToolContext, type ToolDef } from './tools/index.js';

export const SERVER_NAME = 'umami-mcp';
export const SERVER_VERSION = '0.1.0';

export interface BuiltServer {
  server: McpServer;
  registered: ToolDef[];
  withheld: ToolDef[];
}

export function buildServer(config: Config, client = new UmamiClient(config)): BuiltServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const ctx: ToolContext = { client, config };

  const registered: ToolDef[] = [];
  const withheld: ToolDef[] = [];

  for (const tool of allTools) {
    if (!isAllowed(tool, config)) {
      withheld.push(tool);
      continue;
    }
    registered.push(tool);

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.tier === 'read',
          destructiveHint: Boolean(tool.destructive),
          idempotentHint: tool.tier === 'read',
          openWorldHint: true,
        },
      },
      async (args: Record<string, any>) => {
        try {
          const result = await tool.handler(ctx, args ?? {});
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          // Surface the failure to the model as an error result rather than
          // throwing, so it can correct course -- but scrub it first.
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `${tool.name} failed: ${redactUnknown(err)}` }],
          };
        }
      },
    );
  }

  return { server, registered, withheld };
}
