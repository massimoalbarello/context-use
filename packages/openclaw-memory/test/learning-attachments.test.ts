import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  clearStagedAttachments,
  readStagedAttachment,
  stageAttachments,
} from '../src/learning-attachments';
import { attachmentsFromMessages } from '../src/learning-evidence';
import { attachmentDirectory, LearningStore } from '../src/learning-store';

test('staged original bytes survive loss of the host cache and are removed after learning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'learning-attachments-'));
  const connectionId = 'owner';
  const config = { agentId: 'main', serverUrl: 'https://example.com/mcp' };
  const db = new LearningStore({ directory, config, connectionId });
  try {
    const original = join(directory, 'original.pdf');
    const bytes = Buffer.from('%PDF fixture attachment');
    await writeFile(original, bytes);
    const evidence = attachmentsFromMessages([
      { role: 'user', __openclaw: { media: [{ path: original, fileName: 'Document' }] } },
    ]);
    db.capture({ source: 'chat', evidence, now: Date.now() });
    const job = db.next({ agentId: 'main', now: Date.now() })!;
    const input = { directory, connectionId, db, job };
    const api = {
      config: {},
      runtime: {
        media: {
          // biome-ignore lint/complexity/useMaxParams: This implements OpenClaw's media loader signature.
          loadWebMedia: async (path: string, options: { optimizeImages: boolean }) => {
            expect(options.optimizeImages).toBe(false);
            return { buffer: await readFile(path) };
          },
        },
      },
    } as unknown as OpenClawPluginApi;
    await stageAttachments({ ...input, api, agentId: 'main' });
    await rm(original);
    await stageAttachments({ ...input, api, agentId: 'main' });
    const read = () =>
      readStagedAttachment({ directory, connectionId, source: job.source, key: evidence[0]!.key });
    expect(await read()).toEqual(bytes);
    const mask = 0o777;
    const privateMode = 0o700;
    expect((await stat(join(directory, attachmentDirectory(connectionId)))).mode & mask).toBe(
      privateMode,
    );
    await clearStagedAttachments(input);
    await expect(read()).rejects.toThrow();
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
