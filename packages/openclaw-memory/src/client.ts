/** biome-ignore-all lint/complexity/useMaxParams: The Fetch API uses positional arguments. */
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { MCP_TOOL_NAMES, PACKAGE_VERSION, REQUEST_TIMEOUT_MS } from './contract';
import { ConnectionError } from './error';
import { oauthProvider } from './oauth';
import type { ConnectionState } from './state';
import { readState, withConnection } from './state';

export async function withClient<T>(input: {
  directory: string;
  state: ConnectionState;
  run: (client: Client) => Promise<T>;
}): Promise<T> {
  const client = new Client({ name: 'context-use-openclaw', version: PACKAGE_VERSION });
  const transport = new StreamableHTTPClientTransport(new URL(input.state.config.serverUrl), {
    authProvider: oauthProvider({ ...input, interactive: false }),
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.any([
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(init?.signal ? [init.signal] : []),
        ]),
      }),
  });
  try {
    await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
    return await input.run(client);
  } finally {
    await client.close();
  }
}

export async function discoverTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.listTools({ cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) {
      throw new ConnectionError('Context Use returned a repeated tools cursor.');
    }
    if (cursor) {
      seen.add(cursor);
    }
  } while (cursor);
  for (const name of MCP_TOOL_NAMES) {
    if (!tools.some((tool) => tool.name === name)) {
      throw new ConnectionError(`Context Use is missing required tool ${name}.`);
    }
  }
  return tools.filter((tool) => MCP_TOOL_NAMES.some((name) => name === tool.name));
}

export async function callMemoryTool(input: {
  directory: string;
  serverUrl: string;
  agentId: string;
  name: string;
  arguments: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<CallToolResult> {
  return await withConnection({
    directory: input.directory,
    run: async () => {
      input.signal?.throwIfAborted();
      const state = await readState(input.directory);
      if (
        !state ||
        state.config.serverUrl !== input.serverUrl ||
        state.config.agentId !== input.agentId ||
        !state.oauth.tokens
      ) {
        throw new ConnectionError('Context Use is disconnected or requires authorization.');
      }
      return await withClient({
        directory: input.directory,
        state,
        run: async (client) => {
          return await client.callTool(
            { name: input.name, arguments: input.arguments },
            {
              timeout: REQUEST_TIMEOUT_MS,
              signal: input.signal,
            },
          );
        },
      });
    },
  });
}
