import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UmamiClient } from './client.js';
import type { Config } from './config.js';
import { redactUnknown } from './redact.js';
import { allTools, isAllowed, type ToolContext, type ToolDef } from './tools/index.js';

export const SERVER_NAME = 'umami-mcp';
export const SERVER_VERSION = '0.1.7';

export interface BuiltServer {
  server: McpServer;
  registered: ToolDef[];
  withheld: ToolDef[];
}

export interface BuildOptions {
  /**
   * When set, the server is running without usable configuration: tools are
   * still listed, but every call returns this message instead of running.
   * Checked here rather than in the client because several handlers
   * deliberately tolerate individual endpoint failures, which would turn
   * "not configured" into a misleading empty result.
   */
  unavailable?: string;
}

export function buildServer(
  config: Config,
  client = new UmamiClient(config),
  opts: BuildOptions = {},
): BuiltServer {
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

  if (opts.unavailable) {
    // Replace the SDK's tools/call handler outright. Its default validates the
    // arguments before any tool callback runs, so a call with missing or
    // malformed arguments would get an "invalid arguments" error instead of
    // being told the server is not configured -- the one thing worth knowing.
    const message = opts.unavailable;
    const names = new Set(registered.map((t) => t.name));
    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name;
      const text = names.has(name) ? `${name} failed: ${message}` : `Tool ${name} not found`;
      return { isError: true, content: [{ type: 'text' as const, text }] };
    });
  }

  return { server, registered, withheld };
}
