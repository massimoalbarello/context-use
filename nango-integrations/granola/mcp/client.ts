import { z } from "zod";

const MCP_ENDPOINT = "mcp";
const PROXY_RETRIES = 3;

const JsonRpcResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});

const ToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  isError: z.boolean().optional(),
});

export interface GranolaMcpProxy {
  post(config: {
    endpoint: string;
    data: unknown;
    headers?: Record<string, string>;
    retries?: number;
  }): Promise<{ data: unknown }>;
}

export class GranolaMcpClient {
  private nextId = 1;

  constructor(private readonly nango: GranolaMcpProxy) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const id = this.nextId++;
    const response = await this.nango.post({
      endpoint: MCP_ENDPOINT,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      },
      retries: PROXY_RETRIES,
    });

    const message = parseJsonRpc(response.data, id);
    if (message.error) throw new Error(`Granola MCP tool "${name}" failed: ${message.error.message}`);

    const result = ToolResultSchema.parse(message.result ?? {});
    const text = (result.content ?? [])
      .filter((item) => item.type === "text" && item.text)
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (result.isError) throw new Error(`Granola MCP tool "${name}" returned an error: ${text}`);
    return text;
  }
}

function parseJsonRpc(data: unknown, id: number): z.infer<typeof JsonRpcResponseSchema> {
  const values = typeof data === "string" ? parseStringBody(data) : [data];
  const messages = values
    .map((value) => JsonRpcResponseSchema.safeParse(value))
    .filter((value) => value.success)
    .map((value) => value.data);
  return messages.find((message) => message.id === id)
    ?? messages.find((message) => message.result !== undefined || message.error !== undefined)
    ?? { result: data };
}

function parseStringBody(raw: string): unknown[] {
  try {
    return [JSON.parse(raw)];
  } catch {
    const messages: unknown[] = [];
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const payload = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!payload) continue;
      try {
        messages.push(JSON.parse(payload));
      } catch {
        // Ignore keep-alives and non-JSON SSE frames.
      }
    }
    return messages;
  }
}
