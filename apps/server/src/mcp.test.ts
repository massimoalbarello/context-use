import { describe, expect, test } from "bun:test";
import type { AssetRepository, AutomationRepository, PageRepository } from "@context-use/database";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "./mcp-server.ts";
import { createStatelessMcpTransport } from "./mcp-transport.ts";
import type { ObjectStorage } from "./storage.ts";

const skillVersionId = "22222222-2222-4222-8222-222222222222";

async function mcpRequest(server: McpServer, body: Record<string, unknown>) {
  const transport = createStatelessMcpTransport();
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify(body),
    }));
    return await response.json() as {
      result?: { tools?: Array<{ name: string }>; content?: Array<{ type: string; text: string }>; isError?: boolean };
    };
  } finally {
    await transport.close();
    await server.close();
  }
}

function serverWith(automations: AutomationRepository, scopes = new Set<string>(["automations:write"])) {
  return createMcpServer(
    { clientId: "mcp-client", userId: "owner", scopes },
    {} as PageRepository,
    {} as AssetRepository,
    automations,
    {} as ObjectStorage,
  );
}

describe("MCP automation authoring", () => {
  test("advertises skill and cron creation tools", async () => {
    const response = await mcpRequest(serverWith({} as AutomationRepository), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    expect(response.result?.tools?.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "create_automation_skill",
      "create_cron_schedule",
    ]));
  });

  test("creates skills with MCP attribution and schedules their returned version", async () => {
    const calls: Array<{ operation: string; input: unknown; actor?: unknown }> = [];
    const automations = {
      async createSkill(input: unknown, actor: unknown) {
        calls.push({ operation: "skill", input, actor });
        return { id: "11111111-1111-4111-8111-111111111111", current_version_id: skillVersionId };
      },
      async createSchedule(input: unknown) {
        calls.push({ operation: "schedule", input });
        return { id: "33333333-3333-4333-8333-333333333333", ...input as object };
      },
    } as unknown as AutomationRepository;

    const skill = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "create_automation_skill",
        arguments: {
          name: "Daily review",
          instructions_markdown: "Review the current project and record decisions.",
          commit_message: "Create daily review skill",
        },
      },
    });
    expect(JSON.parse(skill.result?.content?.[0]?.text ?? "null")).toMatchObject({ current_version_id: skillVersionId });
    expect(calls[0]).toMatchObject({
      operation: "skill",
      actor: { kind: "mcp", subject: "mcp-client" },
    });

    const schedule = await mcpRequest(serverWith(automations), {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_cron_schedule",
        arguments: {
          name: "Weekday review",
          skill_version_id: skillVersionId,
          cron_expression: "0 9 * * 1-5",
          timezone: "Europe/London",
        },
      },
    });
    expect(JSON.parse(schedule.result?.content?.[0]?.text ?? "null")).toMatchObject({ skill_version_id: skillVersionId });
    expect(calls[1]).toMatchObject({
      operation: "schedule",
      input: { skill_version_id: skillVersionId, input: {}, enabled: true },
    });
  });

  test("requires the automation write scope", async () => {
    const response = await mcpRequest(serverWith({} as AutomationRepository, new Set()), {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "create_automation_skill",
        arguments: {
          name: "Denied skill",
          instructions_markdown: "This must not be created.",
          commit_message: "Attempt denied creation",
        },
      },
    });

    expect(response.result?.isError).toBe(true);
    expect(response.result?.content?.[0]?.text).toContain("insufficient_scope:automations:write");
  });
});
