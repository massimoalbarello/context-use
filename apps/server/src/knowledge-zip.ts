import { TextReader, ZipWriter } from "@zip.js/zip.js";
import type { ObjectStorage } from "./storage.ts";

export const MAX_KNOWLEDGE_ARCHIVE_BYTES = 5 * 1024 ** 3;
const ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");

export type KnowledgeZipWriter = ZipWriter<unknown>;

type StoredKnowledgeAsset = {
  current_path: string;
  s3_object_key: string;
  size_bytes: number | string;
};

export async function addKnowledgeZipDirectory(
  zip: KnowledgeZipWriter,
  entryPath: string,
  signal: AbortSignal,
): Promise<void> {
  await zip.add(entryPath, undefined, {
    directory: true,
    lastModDate: ZIP_DATE,
    signal,
  });
}

export async function addKnowledgeZipText(
  zip: KnowledgeZipWriter,
  entryPath: string,
  text: string,
  signal: AbortSignal,
  options: { compress?: boolean } = {},
): Promise<void> {
  const compress = options.compress ?? false;
  await zip.add(entryPath, new TextReader(text), {
    compressionMethod: compress ? 8 : 0,
    ...(compress ? { level: 6 } : {}),
    lastModDate: ZIP_DATE,
    signal,
  });
}

export async function addStoredKnowledgeAsset(
  zip: KnowledgeZipWriter,
  entryPath: string,
  asset: StoredKnowledgeAsset,
  storage: ObjectStorage,
  signal: AbortSignal,
): Promise<void> {
  const content = new Response(await storage.read(asset.s3_object_key)).body;
  if (!content) throw new Error(`Asset content is missing for ${asset.current_path}`);
  // Supplying the known size avoids unnecessary Zip64 entries, which macOS
  // Archive Utility rejects for otherwise ordinary archives.
  await zip.add(entryPath, {
    readable: content,
    size: Number(asset.size_bytes),
  }, {
    compressionMethod: 0,
    lastModDate: ZIP_DATE,
    signal,
  });
}

export function streamKnowledgeZip(
  writeEntries: (zip: KnowledgeZipWriter, signal: AbortSignal) => Promise<void>,
): ReadableStream<Uint8Array> {
  const bridge = new TransformStream<Uint8Array, Uint8Array>();
  const reader = bridge.readable.getReader();
  const abort = new AbortController();
  let finished = false;
  const producer = (async () => {
    const zip = new ZipWriter<unknown>(bridge.writable, {
      useWebWorkers: false,
      keepOrder: true,
    });
    await writeEntries(zip, abort.signal);
    await zip.close();
  })();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void producer.catch(async (error) => {
        if (finished) return;
        finished = true;
        controller.error(error);
        await reader.cancel(error).catch(() => undefined);
      });
    },
    async pull(controller) {
      if (finished) return;
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finished = true;
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!finished) {
          finished = true;
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      abort.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
      await producer.catch(() => undefined);
    },
  });
}
