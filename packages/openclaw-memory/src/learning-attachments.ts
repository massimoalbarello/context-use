import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { getAgentScopedMediaLocalRoots } from 'openclaw/plugin-sdk/media-local-roots';
import { MAX_ATTACHMENT_BYTES } from './asset-upload';
import { attachmentDirectory, type LearningJob, type LearningStore } from './learning-store';
import { PRIVATE_DIRECTORY_MODE, writePrivateFile } from './private-files';

const attachmentPath = (input: {
  directory: string;
  connectionId: string;
  source: string;
  key: string;
}) =>
  join(
    input.directory,
    attachmentDirectory(input.connectionId),
    createHash('sha256')
      .update(JSON.stringify([input.source, input.key]))
      .digest('hex'),
  );

type JobAttachments = {
  directory: string;
  connectionId: string;
  db: LearningStore;
  job: LearningJob;
};

/** Snapshot host-approved bytes before inference so resets and retries do not depend on host cache retention. */
export async function stageAttachments(
  input: JobAttachments & { api: OpenClawPluginApi; agentId: string },
): Promise<void> {
  for (const item of input.db.attachments(input.job)) {
    if (item.asset) {
      continue;
    }
    const path = attachmentPath({ ...input, source: input.job.source, key: item.key });
    if (
      await stat(path).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return false;
          }
          throw error;
        },
      )
    ) {
      continue;
    }
    const media = await input.api.runtime.media.loadWebMedia(item.attachment.reference, {
      maxBytes: MAX_ATTACHMENT_BYTES,
      optimizeImages: false,
      localRoots: getAgentScopedMediaLocalRoots(input.api.config, input.agentId),
    });
    await mkdir(join(input.directory, attachmentDirectory(input.connectionId)), {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE,
    });
    await writePrivateFile({ path, data: media.buffer });
  }
}

export async function readStagedAttachment(input: {
  directory: string;
  connectionId: string;
  source: string;
  key: string;
}): Promise<Buffer> {
  const path = attachmentPath(input);
  if ((await stat(path)).size > MAX_ATTACHMENT_BYTES) {
    throw new Error('The staged attachment exceeds the upload size limit.');
  }
  return readFile(path);
}

export async function clearStagedAttachments(input: JobAttachments): Promise<void> {
  for (const item of input.db.attachments(input.job)) {
    await rm(attachmentPath({ ...input, source: input.job.source, key: item.key }), {
      force: true,
    });
  }
}
