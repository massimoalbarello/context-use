/** biome-ignore-all lint/complexity/useMaxParams: OpenClaw tools use positional arguments. */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { z } from 'zod';
import { AssetNameConflictError, uploadAttachment } from './asset-upload';
import { FINISH_LEARNING_TOOL, type PluginConfig, SAVE_ATTACHMENT_TOOL } from './contract';
import { readStagedAttachment } from './learning-attachments';
import { isLearningSession, type LearningStore } from './learning-store';
import { toolInputFromSchema } from './tool-input';

const MAX_ASSET_NAME_LENGTH = 160;
const finishInput = toolInputFromSchema(
  z.object({
    omittedAttachments: z
      .array(
        z.object({
          id: z.string(),
          reason: z
            .string()
            .min(1)
            .describe(
              'Explicit retention preference or sensitive content. Never omit a failed upload.',
            ),
        }),
      )
      .optional(),
  }),
);
const attachmentInput = toolInputFromSchema(
  z.object({
    attachmentId: z.string(),
    name: z.string().trim().min(1).max(MAX_ASSET_NAME_LENGTH),
  }),
);

async function saveAttachment(input: {
  db: LearningStore;
  sessionKey: string;
  attachmentId: string;
  name: string;
  directory: string;
  connectionId: string;
  config: PluginConfig;
}) {
  const { db, attachmentId, name, directory, connectionId, config } = input;
  const job = db.current();
  if (!job || job.sessionKey !== input.sessionKey) {
    throw new Error('This learning job is no longer active.');
  }
  const item = db.attachments(job).find((item) => item.key === attachmentId);
  if (!item) {
    throw new Error('This attachment is not part of the active learning job.');
  }
  if (item.asset) {
    return JSON.parse(item.asset);
  }
  let asset: Awaited<ReturnType<typeof uploadAttachment>>;
  const bytes = await readStagedAttachment({
    directory,
    connectionId,
    source: job.source,
    key: attachmentId,
  });
  const uploadName = db.prepareAttachmentUpload({
    jobId: job.id,
    key: attachmentId,
    name,
  });
  try {
    asset = await uploadAttachment({
      directory,
      config,
      connectionId,
      name: uploadName,
      bytes,
    });
  } catch (error) {
    if (error instanceof AssetNameConflictError) {
      db.clearAttachmentUploadName({ jobId: job.id, key: attachmentId });
    }
    throw error;
  }
  db.savedAttachment({ jobId: job.id, key: attachmentId, asset: JSON.stringify(asset) });
  return asset;
}

export function registerLearningTools(input: {
  api: OpenClawPluginApi;
  config: PluginConfig;
  directory: string;
  connectionId: string;
  queue: () => LearningStore;
  connected: () => boolean;
  owns: (context: { agentId?: string; sessionKey?: string }) => boolean;
}): void {
  const { api, config, directory, queue, connected, owns } = input;
  api.registerTool(
    (context) => {
      if (!owns(context) || !isLearningSession(context.sessionKey)) {
        return null;
      }
      return {
        name: FINISH_LEARNING_TOOL,
        label: 'Finish Context Use learning',
        description:
          'Acknowledge this background job only after its evidence has been considered and all required memory operations succeeded. Also use when no information merits saving.',
        parameters: finishInput.parameters,
        execute: (_id, args) => {
          if (!connected()) {
            throw new Error('Context Use is disconnected.');
          }
          const omissions = finishInput.parse(args);
          queue().acknowledge({
            sessionKey: context.sessionKey!,
            omittedAttachments: omissions.omittedAttachments?.map((item) => item.id),
          });
          return Promise.resolve({
            content: [{ type: 'text' as const, text: 'Learning acknowledged.' }],
            details: {},
          });
        },
      };
    },
    { names: [FINISH_LEARNING_TOOL] },
  );
  api.registerTool(
    (context) => {
      if (!owns(context) || !isLearningSession(context.sessionKey)) {
        return null;
      }
      return {
        name: SAVE_ATTACHMENT_TOOL,
        label: 'Save conversation attachment',
        description:
          'Save one attachment from this learning job as a Context Use asset. Supply its attachment ID and a meaningful name. Only queued attachments can be read. Reuses an already saved attachment on retry.',
        parameters: attachmentInput.parameters,
        execute: async (_id, args) => {
          const { attachmentId, name } = attachmentInput.parse(args);
          if (!connected()) {
            throw new Error('Context Use is disconnected.');
          }
          const asset = await saveAttachment({
            db: queue(),
            sessionKey: context.sessionKey!,
            attachmentId,
            name,
            directory,
            connectionId: input.connectionId,
            config,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(asset) }],
            details: asset,
          };
        },
      };
    },
    { names: [SAVE_ATTACHMENT_TOOL] },
  );
}
