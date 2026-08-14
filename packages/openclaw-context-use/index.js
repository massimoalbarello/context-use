import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const PLUGIN_ID = "context-use-memory";
export const ATTACHMENT_TOOL_NAME = "context_use_attachment";
const CURATOR_SESSION_MARKER = ":context-use-curator:";
const TURN_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CAPTURE_CHARS = 20_000;
const DEFAULT_MAX_INSPECT_BYTES = 20_000_000;
const MAX_ASSET_BYTES = 5_000_000_000;
const ATTACHMENT_STORE_SYMBOL = Symbol.for(
  "context-use.openclaw.attachment-store.v1",
);

const CURATOR_SYSTEM_PROMPT = `You are the Context-use curator. Context-use is the only durable memory for this agent.

Review the supplied user/assistant turn and silently decide whether it contains durable, useful personal or project knowledge. Save relevant facts, preferences, people, places, decisions, commitments, reusable work, and relevant assets. Ignore small talk, transient instructions, duplicated facts, secrets, and anything the user asked not to retain. An explicit request to remember something is strong evidence that it should be saved.

Use the Context-use MCP tools directly and follow the current Context-use knowledge-template guidance:
- Before any write, call context-use__prepare_change for the intended page or asset path and obey every returned guide. Reuse its current guidance receipt only where it applies.
- Search and read before creating or updating so you merge with the canonical page instead of making duplicates.
- Information stated directly by the user does not need Nango/source-record provenance. Never invent source records for direct chat input.
- Never write to OpenClaw local memory files.
- Perform actual MCP mutations when warranted. Do not merely describe what should be saved.
- If nothing is worth retaining, make no mutation and finish with NO_CHANGES.

Attachments are first-class knowledge. Each supplied attachment has an opaque id plus exact upload metadata. Use ${ATTACHMENT_TOOL_NAME} with action=inspect when visual/text inspection is useful. When an attachment is relevant: choose its Context-use asset path, prepare that path, call context-use__create_asset_upload with the exact filename/content_type/size_bytes/sha256 supplied, then call ${ATTACHMENT_TOOL_NAME} with action=upload and the exact URL and headers returned by Context-use. Add the resulting context-use://asset reference (or returned page Markdown for images) to the relevant page. Do not claim or record an asset until its byte upload succeeds. If upload fails after asset creation, archive the unlinked asset when possible.
- Never use shell commands or filesystem search to locate, inspect, hash, or upload a supplied attachment. Its id is deliberately opaque; ${ATTACHMENT_TOOL_NAME} is the only permitted byte bridge.

Finish with one compact line beginning SAVED:, UPDATED:, or NO_CHANGES:.`;

function integer(value, fallback, minimum, maximum) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function optionalRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [];
}

export function resolvePluginConfig(pluginConfig = {}, openclawConfig = {}) {
  const raw = optionalRecord(pluginConfig) ?? {};
  const configuredOrigins = stringArray(raw.allowedUploadOrigins);
  const mcpUrl = optionalRecord(optionalRecord(openclawConfig.mcp)?.servers)?.[
    "context-use"
  ]?.url;
  const inferredOrigin = (() => {
    if (typeof mcpUrl !== "string") return undefined;
    try {
      const url = new URL(mcpUrl);
      return url.protocol === "https:" ? url.origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const origins = [
    ...new Set([
      ...configuredOrigins,
      ...(inferredOrigin ? [inferredOrigin] : []),
    ]),
  ].flatMap((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        url.origin === value.replace(/\/$/, "")
        ? [url.origin]
        : [];
    } catch {
      return [];
    }
  });
  return {
    captureEnabled: raw.captureEnabled !== false,
    ownerOnly: raw.ownerOnly !== false,
    timeoutMs: integer(raw.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 300_000),
    maxCaptureChars: integer(
      raw.maxCaptureChars,
      DEFAULT_MAX_CAPTURE_CHARS,
      1_000,
      100_000,
    ),
    maxInspectBytes: integer(
      raw.maxInspectBytes,
      DEFAULT_MAX_INSPECT_BYTES,
      1_024,
      100_000_000,
    ),
    allowedUploadOrigins: new Set(origins),
    retainCuratorTranscripts: raw.retainCuratorTranscripts === true,
    logging: raw.logging === true,
  };
}

function boundedText(value, maxChars) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars)}\n[truncated]`;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      const record = optionalRecord(block);
      if (!record) return [];
      if (
        ["text", "input_text", "output_text"].includes(record.type) &&
        typeof record.text === "string"
      ) {
        return [record.text];
      }
      if (
        record.type === "image" ||
        record.type === "input_image" ||
        record.type === "attachment"
      ) {
        return ["[attachment included in this turn]"];
      }
      return [];
    })
    .join("\n");
}

function latestUserMessage(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  return [...rows]
    .reverse()
    .find((value) => optionalRecord(value)?.role?.toLowerCase?.() === "user");
}

export function extractLatestTurn(
  messages,
  maxChars = DEFAULT_MAX_CAPTURE_CHARS,
) {
  const rows = Array.isArray(messages) ? messages : [];
  let assistant = "";
  let user = "";
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = optionalRecord(rows[index]);
    if (!message || typeof message.role !== "string") continue;
    const text = contentText(message.content ?? message.text);
    if (!assistant && message.role.toLowerCase() === "assistant")
      assistant = text;
    if (message.role.toLowerCase() === "user") {
      user = text;
      break;
    }
  }
  return {
    user: boundedText(user, maxChars),
    assistant: boundedText(assistant, maxChars),
  };
}

function mediaRows(metadata) {
  const record = optionalRecord(metadata) ?? {};
  const paths = [
    ...stringArray(record.mediaPaths),
    ...stringArray(record.MediaPaths),
  ];
  for (const value of [record.mediaPath, record.MediaPath].reverse()) {
    if (typeof value === "string" && value.trim()) paths.unshift(value.trim());
  }
  const types = [
    ...stringArray(record.mediaTypes),
    ...stringArray(record.MediaTypes),
  ];
  for (const value of [record.mediaType, record.MediaType].reverse()) {
    if (typeof value === "string" && value.trim()) types.unshift(value.trim());
  }
  const unique = [];
  const seen = new Set();
  for (let index = 0; index < paths.length; index += 1) {
    const filePath = paths[index];
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    unique.push({ filePath, contentType: types[index] });
  }
  return unique;
}

function latestMessageMedia(messages) {
  return mediaRows(latestUserMessage(messages));
}

function turnKey(event, ctx) {
  const runId = event?.runId ?? ctx?.runId;
  if (typeof runId === "string" && runId) return `run:${runId}`;
  const sessionKey = event?.sessionKey ?? ctx?.sessionKey;
  return typeof sessionKey === "string" && sessionKey
    ? `session:${sessionKey}`
    : undefined;
}

function mimeFromFilename(filename) {
  const extension = path.extname(filename).toLowerCase();
  return (
    {
      ".avif": "image/avif",
      ".csv": "text/csv",
      ".gif": "image/gif",
      ".heic": "image/heic",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".json": "application/json",
      ".md": "text/markdown",
      ".mov": "video/quicktime",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".txt": "text/plain",
      ".webp": "image/webp",
      ".wav": "audio/wav",
    }[extension] ?? "application/octet-stream"
  );
}

function extensionFromMime(contentType) {
  return (
    {
      "image/avif": ".avif",
      "image/gif": ".gif",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    }[contentType] ?? ".bin"
  );
}

function latestInlineImages(messages) {
  const content = optionalRecord(latestUserMessage(messages))?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((value, index) => {
    const block = optionalRecord(value);
    if (!block || block.type !== "image" || typeof block.data !== "string")
      return [];
    const contentType =
      typeof block.mimeType === "string" && block.mimeType.startsWith("image/")
        ? block.mimeType.toLowerCase()
        : "image/png";
    const data = Buffer.from(block.data, "base64");
    if (data.length === 0 || data.length > MAX_ASSET_BYTES) return [];
    return [
      {
        data,
        filename: `chat-image-${index + 1}${extensionFromMime(contentType)}`,
        contentType,
      },
    ];
  });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function describeAttachment(row, curatorSessionKey) {
  if (!path.isAbsolute(row.filePath))
    throw new Error("attachment path is not absolute");
  const sourceLstat = await lstat(row.filePath);
  if (!sourceLstat.isFile() && !sourceLstat.isSymbolicLink())
    throw new Error("attachment is not a regular file");
  const resolvedPath = await realpath(row.filePath);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile())
    throw new Error("attachment does not resolve to a regular file");
  if (fileStat.size > MAX_ASSET_BYTES)
    throw new Error("attachment exceeds Context-use's 5 GB asset limit");
  const filename = path.basename(row.filePath);
  return {
    id: randomUUID(),
    curatorSessionKey,
    filePath: resolvedPath,
    filename,
    contentType:
      typeof row.contentType === "string" && row.contentType.trim()
        ? row.contentType.split(";")[0].trim().toLowerCase()
        : mimeFromFilename(filename),
    sizeBytes: fileStat.size,
    sha256: await sha256File(resolvedPath),
    expiresAt: Date.now() + TURN_TTL_MS,
    uploaded: false,
  };
}

function describeInlineAttachment(row, curatorSessionKey) {
  return {
    id: randomUUID(),
    curatorSessionKey,
    data: row.data,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.data.length,
    sha256: createHash("sha256").update(row.data).digest("hex"),
    expiresAt: Date.now() + TURN_TTL_MS,
    uploaded: false,
  };
}

async function attachmentBytes(attachment) {
  return attachment.data ?? readFile(attachment.filePath);
}

function attachmentUploadBody(attachment) {
  return attachment.data ?? createReadStream(attachment.filePath);
}

function jsonTextResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function processAttachmentStore() {
  if (!(globalThis[ATTACHMENT_STORE_SYMBOL] instanceof Map)) {
    globalThis[ATTACHMENT_STORE_SYMBOL] = new Map();
  }
  return globalThis[ATTACHMENT_STORE_SYMBOL];
}

function requireAttachment(rawArgs, toolContext, attachmentStore) {
  const args = optionalRecord(rawArgs) ?? {};
  const id = typeof args.attachment_id === "string" ? args.attachment_id : "";
  const attachment = attachmentStore.get(id);
  if (!attachment) throw new Error("Unknown or expired attachment_id");
  if (
    Number.isFinite(attachment.expiresAt) &&
    attachment.expiresAt <= Date.now()
  ) {
    attachmentStore.delete(id);
    throw new Error("Unknown or expired attachment_id");
  }
  if (
    toolContext.sessionKey &&
    attachment.curatorSessionKey !== toolContext.sessionKey
  ) {
    throw new Error("This attachment_id is not valid in the current session");
  }
  return { args, attachment };
}

function validateUploadRequest(args, attachment, allowedOrigins) {
  if (typeof args.url !== "string") throw new Error("upload requires url");
  const url = new URL(args.url);
  if (!allowedOrigins.has(url.origin))
    throw new Error(`Upload origin is not allowed: ${url.origin}`);
  if (!/^\/api\/mcp\/assets\/[0-9a-f-]+\/content$/i.test(url.pathname)) {
    throw new Error("Upload URL is not a Context-use MCP asset-content URL");
  }
  if (url.username || url.password)
    throw new Error("Upload URL credentials are not allowed");
  const suppliedHeaders = optionalRecord(args.headers);
  if (!suppliedHeaders)
    throw new Error("upload requires headers returned by Context-use");
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(suppliedHeaders)) {
    const name = rawName.toLowerCase();
    if (
      ![
        "content-type",
        "content-length",
        "x-context-use-upload-token",
      ].includes(name)
    ) {
      throw new Error(`Upload header is not allowed: ${rawName}`);
    }
    if (typeof rawValue !== "string")
      throw new Error(`Upload header must be a string: ${rawName}`);
    headers[name] = rawValue;
  }
  if (headers["content-length"] !== String(attachment.sizeBytes)) {
    throw new Error("Upload content-length does not match the attachment");
  }
  if (
    headers["content-type"]?.toLowerCase() !==
    attachment.contentType.toLowerCase()
  ) {
    throw new Error("Upload content-type does not match the attachment");
  }
  if (!headers["x-context-use-upload-token"])
    throw new Error("Missing Context-use upload token");
  return { url, headers };
}

export function createAttachmentTool(
  toolContext,
  attachmentStore,
  config,
  dependencies = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  return {
    name: ATTACHMENT_TOOL_NAME,
    label: "Context-use Attachment",
    description:
      "Inspect an opaque attachment from the current chat turn, or stream its exact bytes to a signed Context-use asset upload URL. This tool cannot read arbitrary paths or upload to other origins.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action", "attachment_id"],
      properties: {
        action: { type: "string", enum: ["inspect", "upload"] },
        attachment_id: {
          type: "string",
          description: "Opaque attachment id from the curator prompt.",
        },
        url: {
          type: "string",
          description:
            "Exact upload URL returned by context-use__create_asset_upload.",
        },
        headers: {
          type: "object",
          description:
            "Exact upload headers returned by context-use__create_asset_upload.",
          additionalProperties: { type: "string" },
        },
      },
    },
    execute: async (_toolCallId, rawArgs, signal) => {
      const { args, attachment } = requireAttachment(
        rawArgs,
        toolContext,
        attachmentStore,
      );
      if (args.action === "inspect") {
        const metadata = {
          attachment_id: attachment.id,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size_bytes: attachment.sizeBytes,
          sha256: attachment.sha256,
        };
        if (attachment.sizeBytes > config.maxInspectBytes) {
          return jsonTextResult({
            ...metadata,
            inspection: "skipped: attachment exceeds maxInspectBytes",
          });
        }
        if (attachment.contentType.startsWith("image/")) {
          const data = await attachmentBytes(attachment);
          return {
            content: [
              { type: "text", text: JSON.stringify(metadata, null, 2) },
              {
                type: "image",
                data: data.toString("base64"),
                mimeType: attachment.contentType,
              },
            ],
            details: metadata,
          };
        }
        if (
          attachment.contentType.startsWith("text/") ||
          attachment.contentType === "application/json"
        ) {
          const data = attachment.data
            ? attachment.data.toString("utf8")
            : await readFile(attachment.filePath, "utf8");
          return jsonTextResult({
            ...metadata,
            text: boundedText(data, 100_000),
          });
        }
        return jsonTextResult({
          ...metadata,
          inspection: "metadata only for this media type",
        });
      }
      if (args.action !== "upload")
        throw new Error("action must be inspect or upload");
      if (attachment.uploaded)
        return jsonTextResult({
          ok: true,
          already_uploaded: true,
          attachment_id: attachment.id,
        });
      const request = validateUploadRequest(
        args,
        attachment,
        config.allowedUploadOrigins,
      );
      const response = await fetchImpl(request.url, {
        method: "PUT",
        headers: request.headers,
        body: attachmentUploadBody(attachment),
        duplex: "half",
        redirect: "error",
        signal,
      });
      const responseText = boundedText(await response.text(), 2_000);
      if (!response.ok)
        throw new Error(
          `Context-use asset upload failed (${response.status}): ${responseText}`,
        );
      attachment.uploaded = true;
      return jsonTextResult({
        ok: true,
        attachment_id: attachment.id,
        status: response.status,
      });
    },
  };
}

function buildCuratorPrompt(turn, latest, attachments, config) {
  const attachmentBlock = attachments.length
    ? attachments
        .map((attachment) =>
          JSON.stringify({
            attachment_id: attachment.id,
            filename: attachment.filename,
            content_type: attachment.contentType,
            size_bytes: attachment.sizeBytes,
            sha256: attachment.sha256,
          }),
        )
        .join("\n")
    : "(none)";
  return `Curate this completed chat turn into Context-use when warranted.

USER MESSAGE:
${boundedText(turn?.content || latest.user, config.maxCaptureChars) || "(unavailable)"}

ASSISTANT RESPONSE:
${boundedText(latest.assistant, config.maxCaptureChars) || "(unavailable)"}

ATTACHMENTS:
${attachmentBlock}`;
}

function buildMemoryPromptSection() {
  return [
    "## Durable Memory: Context-use",
    "Context-use is the sole durable memory. Never write durable facts or assets to MEMORY.md, memory/*.md, or other OpenClaw-local memory files.",
    "Relevant Context-use recall may be injected automatically before you answer. Use Context-use MCP read tools directly when you need more detail or verification.",
    "A lifecycle curator checks completed turns and stores worthwhile facts and assets according to the Context-use template. Do not claim that something was saved unless an actual Context-use mutation has succeeded in the current turn.",
    "",
  ];
}

export function createPluginState(api) {
  const pendingTurns = new Map();
  // OpenClaw may execute cached plugin tools through a cold-loaded copy of the
  // plugin. A process-global registry keeps opaque handles available across
  // those instances without writing attachment bytes or paths to disk.
  const attachmentStore = processAttachmentStore();
  const processedRuns = new Map();

  const currentConfig = () => {
    const openclawConfig = api.runtime?.config?.current?.() ?? api.config;
    const entry = optionalRecord(
      optionalRecord(openclawConfig?.plugins)?.entries?.[PLUGIN_ID],
    );
    return resolvePluginConfig(
      entry?.config ?? api.pluginConfig,
      openclawConfig,
    );
  };

  const prune = () => {
    const now = Date.now();
    const cutoff = now - TURN_TTL_MS;
    for (const [key, value] of pendingTurns)
      if (value.updatedAt < cutoff) pendingTurns.delete(key);
    for (const [key, processedAt] of processedRuns)
      if (processedAt < cutoff) processedRuns.delete(key);
    for (const [key, attachment] of attachmentStore)
      if (attachment.expiresAt <= now) attachmentStore.delete(key);
  };

  const recordInbound = (event, ctx, ownerKnown, senderIsOwner) => {
    prune();
    const key = turnKey(event, ctx);
    if (!key) return;
    const prior = pendingTurns.get(key) ?? { media: [], updatedAt: Date.now() };
    const media = [...prior.media, ...mediaRows(event.metadata)];
    const deduped = [
      ...new Map(media.map((entry) => [entry.filePath, entry])).values(),
    ];
    pendingTurns.set(key, {
      ...prior,
      content:
        typeof event.content === "string" && event.content.trim()
          ? event.content
          : prior.content,
      media: deduped,
      ownerKnown: ownerKnown || prior.ownerKnown === true,
      senderIsOwner: ownerKnown ? senderIsOwner : prior.senderIsOwner,
      updatedAt: Date.now(),
    });
  };

  const recordTranscriptMessage = (event, ctx) => {
    const message = optionalRecord(event.message);
    if (message?.role?.toLowerCase?.() !== "user") return;
    const openclawMetadata = optionalRecord(message.__openclaw);
    const senderIsOwner =
      typeof openclawMetadata?.senderIsOwner === "boolean"
        ? openclawMetadata.senderIsOwner
        : undefined;
    recordInbound(
      {
        content: contentText(message.content),
        metadata: message,
        sessionKey: event.sessionKey,
      },
      ctx,
      typeof senderIsOwner === "boolean",
      senderIsOwner === true,
    );
  };

  const capture = async (event, ctx) => {
    prune();
    const config = currentConfig();
    if (!config.captureEnabled || !event.success) return;
    if (ctx.sessionKey?.includes(CURATOR_SESSION_MARKER)) return;
    if (
      ["cron", "heartbeat", "subagent"].includes(
        String(ctx.trigger ?? "").toLowerCase(),
      )
    )
      return;
    const key = turnKey(event, ctx);
    const runIdentity = event.runId ?? ctx.runId ?? key;
    if (runIdentity && processedRuns.has(runIdentity)) return;
    if (runIdentity) processedRuns.set(runIdentity, Date.now());
    const sessionKey = ctx.sessionKey ? `session:${ctx.sessionKey}` : undefined;
    const pendingKeys = [...new Set([key, sessionKey].filter(Boolean))];
    const pending = pendingKeys
      .map((pendingKey) => pendingTurns.get(pendingKey))
      .filter(Boolean);
    for (const pendingKey of pendingKeys) pendingTurns.delete(pendingKey);
    const owner = pending.find((candidate) => candidate.ownerKnown === true);
    const turn = pending.length
      ? {
          content: pending.find((candidate) => candidate.content)?.content,
          media: pending.flatMap((candidate) => candidate.media ?? []),
          ownerKnown: owner?.ownerKnown === true,
          senderIsOwner: owner?.senderIsOwner,
        }
      : undefined;
    if (config.ownerOnly && turn?.ownerKnown && turn.senderIsOwner !== true)
      return;
    const latest = extractLatestTurn(event.messages, config.maxCaptureChars);
    if (!turn?.content && !latest.user) return;

    const agentId = ctx.agentId || "main";
    const curatorSessionKey = `agent:${agentId}${CURATOR_SESSION_MARKER}${randomUUID()}`;
    const attachments = [];
    const media = [
      ...new Map(
        [...(turn?.media ?? []), ...latestMessageMedia(event.messages)].map(
          (row) => [row.filePath, row],
        ),
      ).values(),
    ];
    for (const row of media) {
      try {
        const attachment = await describeAttachment(row, curatorSessionKey);
        attachments.push(attachment);
      } catch (error) {
        api.logger.warn?.(
          `${PLUGIN_ID}: skipped attachment: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const row of latestInlineImages(event.messages)) {
      attachments.push(describeInlineAttachment(row, curatorSessionKey));
    }
    const uniqueAttachments = [
      ...new Map(
        attachments.map((attachment) => [
          `${attachment.sha256}:${attachment.sizeBytes}:${attachment.contentType}`,
          attachment,
        ]),
      ).values(),
    ];
    for (const attachment of uniqueAttachments)
      attachmentStore.set(attachment.id, attachment);

    const prompt = buildCuratorPrompt(turn, latest, uniqueAttachments, config);
    let waitResult;
    try {
      const run = await api.runtime.subagent.run({
        sessionKey: curatorSessionKey,
        message: prompt,
        extraSystemPrompt: CURATOR_SYSTEM_PROMPT,
        ...(ctx.modelProviderId ? { provider: ctx.modelProviderId } : {}),
        ...(ctx.modelId ? { model: ctx.modelId } : {}),
        lane: `context-use-memory:${agentId}`,
        lightContext: true,
        deliver: false,
        idempotencyKey: `context-use-capture:${runIdentity ?? randomUUID()}`,
        ...(ctx.workspaceDir ? { cwd: ctx.workspaceDir } : {}),
      });
      waitResult = await api.runtime.subagent.waitForRun({
        runId: run.runId,
        timeoutMs: config.timeoutMs,
      });
      if (waitResult.status !== "ok") {
        api.logger.warn?.(
          `${PLUGIN_ID}: curator ${waitResult.status}${waitResult.error ? `: ${waitResult.error}` : ""}`,
        );
      } else if (config.logging) {
        const result = await api.runtime.subagent.getSessionMessages({
          sessionKey: curatorSessionKey,
          limit: 4,
        });
        const summary = extractLatestTurn(result.messages, 2_000).assistant;
        api.logger.info?.(
          `${PLUGIN_ID}: curator completed${summary ? `: ${summary}` : ""}`,
        );
      }
    } catch (error) {
      api.logger.error?.(
        `${PLUGIN_ID}: curator failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (waitResult?.status !== "timeout") {
        for (const attachment of uniqueAttachments)
          attachmentStore.delete(attachment.id);
      }
      if (
        !config.retainCuratorTranscripts &&
        waitResult?.status !== "timeout"
      ) {
        await api.runtime.subagent
          .deleteSession({
            sessionKey: curatorSessionKey,
            deleteTranscript: true,
          })
          .catch(() => undefined);
      }
    }
  };

  return {
    pendingTurns,
    attachmentStore,
    recordInbound,
    recordTranscriptMessage,
    capture,
    currentConfig,
  };
}

const plugin = {
  id: PLUGIN_ID,
  name: "Context-use Memory",
  description: "Context-use durable memory binding for OpenClaw",
  kind: "memory",
  register(api) {
    const state = createPluginState(api);
    api.registerMemoryCapability({
      promptBuilder: buildMemoryPromptSection,
      flushPlanResolver: () => null,
    });
    api.registerTool(
      (toolContext) =>
        createAttachmentTool(
          toolContext,
          state.attachmentStore,
          state.currentConfig(),
        ),
      { name: ATTACHMENT_TOOL_NAME },
    );
    api.on("inbound_claim", (event, ctx) => {
      state.recordInbound(event, ctx, true, event.senderIsOwner === true);
    });
    api.on("message_received", (event, ctx) => {
      state.recordInbound(event, ctx, false, false);
    });
    api.on("before_message_write", state.recordTranscriptMessage);
    api.on("agent_end", state.capture);
  },
};

export default plugin;
