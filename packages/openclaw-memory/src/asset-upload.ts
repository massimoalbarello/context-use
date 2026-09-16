import { createHash } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { withMemoryClient } from './client';
import { type PluginConfig, REQUEST_TIMEOUT_MS } from './contract';

export const MAX_ATTACHMENT_BYTES = 104_857_600;
export class AssetNameConflictError extends Error {}
export const AssetSchema = z.object({
  address: z.string().startsWith('context-use://asset/'),
  name: z.string(),
  mediaType: z.string(),
  sizeBytes: z.number().int().positive(),
});
const TransferSchema = z.object({
  url: z.url(),
  method: z.enum(['GET', 'PUT']),
  requiredHeaders: z.record(z.string(), z.string()),
});
const AssetListSchema = z.object({
  items: z.array(AssetSchema),
  nextCursor: z.string().nullable(),
});

async function call(input: { client: Client; name: string; args: Record<string, unknown> }) {
  const result = await input.client.callTool(
    { name: input.name, arguments: input.args },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  if (result.isError || !result.structuredContent) {
    throw new Error('Context Use could not prepare the attachment transfer.');
  }
  return result.structuredContent;
}

async function transfer(input: {
  request: z.infer<typeof TransferSchema>;
  serverUrl: string;
  body?: Uint8Array;
}): Promise<Response> {
  const url = new URL(input.request.url);
  if (url.origin !== new URL(input.serverUrl).origin || url.username || url.password) {
    throw new Error('Context Use returned an invalid attachment transfer destination.');
  }
  const response = await fetch(url, {
    method: input.request.method,
    headers: input.request.requiredHeaders,
    body: input.body ? new Blob([new Uint8Array(input.body)]) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      'Context Use attachment transfer failed; its result must be checked before retrying.',
    );
  }
  return response;
}

async function downloadMatches(input: { response: Response; bytes: Uint8Array }): Promise<boolean> {
  const reader = input.response.body?.getReader();
  if (!reader) {
    throw new Error('Context Use returned an empty attachment download.');
  }
  const hash = createHash('sha256');
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > input.bytes.byteLength) {
        throw new Error('Attachment download exceeds its declared size.');
      }
      hash.update(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return (
    size === input.bytes.byteLength &&
    hash.digest('hex') === createHash('sha256').update(input.bytes).digest('hex')
  );
}

/** Compare immutable bytes before reusing a name, including after an uncertain upload. */
async function existingAsset(input: {
  client: Client;
  name: string;
  bytes: Uint8Array;
  serverUrl: string;
}) {
  let cursor: string | undefined;
  const seen = new Set<string>();
  let conflict = false;
  do {
    const page = AssetListSchema.parse(
      await call({ client: input.client, name: 'list_assets', args: { cursor } }),
    );
    const candidates = page.items.filter((item) => item.name === input.name);
    conflict ||= candidates.length > 0;
    for (const asset of candidates.filter((item) => item.sizeBytes === input.bytes.byteLength)) {
      const detail = z
        .object({ download: TransferSchema.extend({ method: z.literal('GET') }) })
        .parse(
          await call({
            client: input.client,
            name: 'read_asset',
            args: { address: asset.address, includeDownload: true },
          }),
        );
      const response = await transfer({ request: detail.download, serverUrl: input.serverUrl });
      if (await downloadMatches({ response, bytes: input.bytes })) {
        return asset;
      }
    }
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) {
      throw new Error('Context Use returned a repeated asset cursor.');
    }
    if (cursor) {
      seen.add(cursor);
    }
  } while (cursor);
  if (conflict) {
    throw new AssetNameConflictError(
      'A different asset has this name. Choose a more specific name for this attachment.',
    );
  }
  return undefined;
}

export async function uploadAttachment(input: {
  directory: string;
  connectionId: string;
  config: PluginConfig;
  name: string;
  bytes: Uint8Array;
}): Promise<z.infer<typeof AssetSchema>> {
  if (!input.bytes.byteLength || input.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachments must be nonempty and no larger than 100 MiB.');
  }
  return await withMemoryClient({
    directory: input.directory,
    connectionId: input.connectionId,
    ...input.config,
    run: async (client) => {
      const existing = await existingAsset({
        client,
        name: input.name,
        bytes: input.bytes,
        serverUrl: input.config.serverUrl,
      });
      if (existing) {
        return existing;
      }
      const request = TransferSchema.extend({ method: z.literal('PUT') }).parse(
        await call({ client, name: 'create_asset_upload', args: { name: input.name } }),
      );
      const response = await transfer({
        request,
        serverUrl: input.config.serverUrl,
        body: input.bytes,
      });
      return AssetSchema.parse(await response.json());
    },
  });
}
