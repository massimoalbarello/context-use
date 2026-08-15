import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plugin, {
  ATTACHMENT_TOOL_NAME,
  createAttachmentTool,
  createPluginState,
  extractLatestTurn,
  resolvePluginConfig,
} from "./index.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryFile(name, body) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "context-use-openclaw-test-"),
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, body);
  return filePath;
}

function apiFixture(overrides = {}) {
  return {
    pluginConfig: {},
    config: {
      mcp: {
        servers: { "context-use": { url: "https://memory.example/mcp" } },
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    runtime: {
      config: {
        current: () => ({
          mcp: {
            servers: { "context-use": { url: "https://memory.example/mcp" } },
          },
        }),
      },
      subagent: {
        run: async () => ({ runId: "curator-run" }),
        waitForRun: async () => ({ status: "ok" }),
        getSessionMessages: async () => ({ messages: [] }),
        deleteSession: async () => {},
      },
    },
    ...overrides,
  };
}

test("resolves the upload origin from the Context-use MCP configuration", () => {
  const config = resolvePluginConfig(
    {},
    {
      mcp: {
        servers: { "context-use": { url: "https://memory.example/mcp" } },
      },
    },
  );
  expect([...config.allowedUploadOrigins]).toEqual(["https://memory.example"]);
});

test("extracts only the latest user/assistant turn", () => {
  expect(
    extractLatestTurn([
      { role: "user", content: "older" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: [{ type: "text", text: "remember this" }] },
      { role: "assistant", content: [{ type: "output_text", text: "okay" }] },
    ]),
  ).toEqual({ user: "remember this", assistant: "okay" });
});

test("plugin claims the memory slot and registers the lifecycle hooks", () => {
  const registrations = { hooks: [], tools: [], memory: undefined };
  const api = apiFixture({
    registerMemoryCapability(capability) {
      registrations.memory = capability;
    },
    registerTool(tool, options) {
      registrations.tools.push({ tool, options });
    },
    on(name, handler) {
      registrations.hooks.push({ name, handler });
    },
  });
  plugin.register(api);
  expect(
    registrations.memory
      .promptBuilder({ availableTools: new Set() })
      .join("\n"),
  ).toContain("sole durable memory");
  expect(registrations.memory.flushPlanResolver()).toBeNull();
  expect(registrations.tools[0].options.name).toBe(ATTACHMENT_TOOL_NAME);
  expect(registrations.hooks.map((entry) => entry.name)).toEqual([
    "inbound_claim",
    "message_received",
    "before_message_write",
    "agent_end",
  ]);
});

test("plugin instances share only the opaque attachment registry", () => {
  const first = createPluginState(apiFixture());
  const second = createPluginState(apiFixture());
  expect(first.attachmentStore).toBe(second.attachmentStore);
  expect(first.pendingTurns).not.toBe(second.pendingTurns);
});

describe("attachment bridge", () => {
  test("rejects and removes expired handles", async () => {
    const attachmentStore = new Map([
      [
        "expired-id",
        {
          id: "expired-id",
          curatorSessionKey: "curator-session",
          expiresAt: Date.now() - 1,
        },
      ],
    ]);
    const tool = createAttachmentTool(
      { sessionKey: "curator-session" },
      attachmentStore,
      {
        maxInspectBytes: 100,
        allowedUploadOrigins: new Set(["https://memory.example"]),
      },
    );

    expect(
      tool.execute("call", {
        action: "inspect",
        attachment_id: "expired-id",
      }),
    ).rejects.toThrow("Unknown or expired attachment_id");
    expect(attachmentStore.has("expired-id")).toBe(false);
  });

  test("returns image bytes to the curator without exposing arbitrary paths", async () => {
    const filePath = await temporaryFile(
      "tiny.png",
      Buffer.from("not-a-real-png"),
    );
    const attachment = {
      id: "opaque-id",
      curatorSessionKey: "curator-session",
      filePath,
      filename: "tiny.png",
      contentType: "image/png",
      sizeBytes: 14,
      sha256: "hash",
      uploaded: false,
    };
    const tool = createAttachmentTool(
      { sessionKey: "curator-session" },
      new Map([[attachment.id, attachment]]),
      {
        maxInspectBytes: 100,
        allowedUploadOrigins: new Set(["https://memory.example"]),
      },
    );
    const result = await tool.execute("call", {
      action: "inspect",
      attachment_id: attachment.id,
    });
    expect(result.content.map((entry) => entry.type)).toEqual([
      "text",
      "image",
    ]);
    expect(result.content[1].data).toBe(
      Buffer.from("not-a-real-png").toString("base64"),
    );
  });

  test("uploads only exact bytes to an allowed Context-use asset URL", async () => {
    const bytes = Buffer.from("asset body");
    const filePath = await temporaryFile("note.txt", bytes);
    const attachment = {
      id: "opaque-id",
      curatorSessionKey: "curator-session",
      filePath,
      filename: "note.txt",
      contentType: "text/plain",
      sizeBytes: bytes.length,
      sha256: "hash",
      uploaded: false,
    };
    let request;
    const tool = createAttachmentTool(
      { sessionKey: "curator-session" },
      new Map([[attachment.id, attachment]]),
      {
        maxInspectBytes: 100,
        allowedUploadOrigins: new Set(["https://memory.example"]),
      },
      {
        fetchImpl: async (url, options) => {
          const chunks = [];
          for await (const chunk of options.body) chunks.push(chunk);
          request = { url: String(url), options, body: Buffer.concat(chunks) };
          return { ok: true, status: 201, text: async () => "" };
        },
      },
    );
    const result = await tool.execute("call", {
      action: "upload",
      attachment_id: attachment.id,
      url: "https://memory.example/api/mcp/assets/123e4567-e89b-12d3-a456-426614174000/content",
      headers: {
        "content-type": "text/plain",
        "content-length": String(bytes.length),
        "x-context-use-upload-token": "signed",
      },
    });
    expect(result.details.ok).toBe(true);
    expect(request.body).toEqual(bytes);
    expect(request.options.method).toBe("PUT");
  });

  test("rejects uploads to any other origin", async () => {
    const filePath = await temporaryFile("note.txt", "asset body");
    const attachment = {
      id: "opaque-id",
      curatorSessionKey: "curator-session",
      filePath,
      filename: "note.txt",
      contentType: "text/plain",
      sizeBytes: 10,
      sha256: "hash",
      uploaded: false,
    };
    const tool = createAttachmentTool(
      { sessionKey: "curator-session" },
      new Map([[attachment.id, attachment]]),
      {
        maxInspectBytes: 100,
        allowedUploadOrigins: new Set(["https://memory.example"]),
      },
    );
    expect(
      tool.execute("call", {
        action: "upload",
        attachment_id: attachment.id,
        url: "https://evil.example/api/mcp/assets/123e4567-e89b-12d3-a456-426614174000/content",
        headers: {
          "content-type": "text/plain",
          "content-length": "10",
          "x-context-use-upload-token": "signed",
        },
      }),
    ).rejects.toThrow("not allowed");
  });
});

test("capture launches the curator with the parent provider and model", async () => {
  let runParams;
  const api = apiFixture({
    runtime: {
      config: {
        current: () => ({
          mcp: {
            servers: { "context-use": { url: "https://memory.example/mcp" } },
          },
        }),
      },
      subagent: {
        run: async (params) => {
          runParams = params;
          return { runId: "curator-run" };
        },
        waitForRun: async () => ({ status: "ok" }),
        getSessionMessages: async () => ({ messages: [] }),
        deleteSession: async () => {},
      },
    },
  });
  const state = createPluginState(api);
  state.recordInbound(
    {
      runId: "parent-run",
      content: "My favourite colour is aubergine.",
      senderIsOwner: true,
    },
    { runId: "parent-run" },
    true,
    true,
  );
  await state.capture(
    {
      runId: "parent-run",
      success: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "My favourite colour is aubergine." },
            {
              type: "image",
              data: Buffer.from("tiny image").toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
        { role: "assistant", content: "Noted." },
      ],
    },
    {
      runId: "parent-run",
      agentId: "main",
      sessionKey: "agent:main:telegram:dm:1",
      modelProviderId: "openai",
      modelId: "gpt-5.6-sol",
      workspaceDir: "/tmp",
    },
  );
  expect(runParams.provider).toBe("openai");
  expect(runParams.model).toBe("gpt-5.6-sol");
  expect(runParams.message).toContain("aubergine");
  expect(runParams.message).toContain("chat-image-2.png");
  expect(runParams.message).toContain("image/png");
  expect(runParams.deliver).toBe(false);
});

test("capture includes OpenClaw-managed transcript media", async () => {
  const filePath = await temporaryFile("managed-image.png", "managed bytes");
  let runParams;
  const api = apiFixture({
    runtime: {
      config: {
        current: () => ({
          mcp: {
            servers: { "context-use": { url: "https://memory.example/mcp" } },
          },
        }),
      },
      subagent: {
        run: async (params) => {
          runParams = params;
          return { runId: "curator-run" };
        },
        waitForRun: async () => ({ status: "ok" }),
        getSessionMessages: async () => ({ messages: [] }),
        deleteSession: async () => {},
      },
    },
  });
  const state = createPluginState(api);
  state.recordTranscriptMessage(
    {
      sessionKey: "agent:main:webchat:test",
      message: {
        role: "user",
        content: "Remember this badge.",
        MediaPath: filePath,
        MediaPaths: [filePath],
        MediaType: "image/png",
        MediaTypes: ["image/png"],
      },
    },
    { sessionKey: "agent:main:webchat:test" },
  );
  await state.capture(
    {
      runId: "managed-media-run",
      success: true,
      messages: [
        {
          role: "user",
          content: "Remember this badge.",
        },
        { role: "assistant", content: "OK" },
      ],
    },
    {
      runId: "managed-media-run",
      agentId: "main",
      sessionKey: "agent:main:webchat:test",
      modelProviderId: "openai",
      modelId: "gpt-5.6-sol",
    },
  );
  expect(runParams.message).toContain("managed-image.png");
  expect(runParams.message.match(/managed-image\.png/g)).toHaveLength(1);
  expect(runParams.message).toContain("image/png");
  expect(runParams.message).not.toContain(filePath);
});

test("capture keeps attachment handles alive when the curator times out", async () => {
  const filePath = await temporaryFile("slow-image.png", "managed bytes");
  let runParams;
  let deletedSession = false;
  const api = apiFixture({
    runtime: {
      config: {
        current: () => ({
          mcp: {
            servers: { "context-use": { url: "https://memory.example/mcp" } },
          },
        }),
      },
      subagent: {
        run: async (params) => {
          runParams = params;
          return { runId: "slow-curator-run" };
        },
        waitForRun: async () => ({ status: "timeout" }),
        getSessionMessages: async () => ({ messages: [] }),
        deleteSession: async () => {
          deletedSession = true;
        },
      },
    },
  });
  const state = createPluginState(api);
  state.recordTranscriptMessage(
    {
      sessionKey: "agent:main:webchat:slow",
      message: {
        role: "user",
        content: "Remember this image.",
        MediaPath: filePath,
        MediaType: "image/png",
      },
    },
    { sessionKey: "agent:main:webchat:slow" },
  );

  await state.capture(
    {
      runId: "slow-media-run",
      success: true,
      messages: [
        { role: "user", content: "Remember this image." },
        { role: "assistant", content: "OK" },
      ],
    },
    {
      runId: "slow-media-run",
      agentId: "main",
      sessionKey: "agent:main:webchat:slow",
      modelProviderId: "openai",
      modelId: "gpt-5.6-sol",
    },
  );

  const attachmentId = runParams.message.match(
    /"attachment_id":"([^"]+)"/,
  )?.[1];
  expect(attachmentId).toBeString();
  expect(state.attachmentStore.has(attachmentId)).toBe(true);
  expect(deletedSession).toBe(false);
  state.attachmentStore.delete(attachmentId);
});
