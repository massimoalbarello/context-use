import type { Storage } from './storage.ts';

interface FilePublication {
  write(input: { key: string; file: Blob }): Promise<number>;
  retain(keys: Iterable<string>): void;
}

interface PublishFilesInput<T> {
  storage: Storage;
  publish(files: FilePublication): Promise<T>;
}

/** Keep only files claimed by a committed publication, including after partial writes or retries. */
export async function publishFiles<T>({ storage, publish }: PublishFilesInput<T>): Promise<T> {
  const unused = new Set<string>();
  async function discard(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(unused, async (key) => {
        if (await storage.exists(key)) {
          await storage.delete(key);
        }
      }),
    );
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        'Could not remove unpublished files',
      );
    }
  }

  let result: T;
  try {
    result = await publish({
      write: async ({ key, file }) => {
        unused.add(key);
        const size = await storage.write(key, file);
        if (size !== file.size) {
          throw new Error('File was not fully written');
        }
        return size;
      },
      retain: (keys) => {
        for (const key of keys) {
          unused.delete(key);
        }
      },
    });
  } catch (error) {
    try {
      await discard();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'File publication and cleanup failed');
    }
    throw error;
  }
  await discard();
  return result;
}
