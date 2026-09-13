import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FaceAnalysisError } from './analyzer.ts';
import { FACE_MODEL_FILES } from './models.ts';

async function checksum(file: Blob): Promise<string> {
  const hash = new Bun.CryptoHasher('sha256');
  for await (const bytes of file.stream()) {
    hash.update(bytes);
  }
  return hash.digest('hex');
}

async function downloadModel({
  response,
  path,
  maximumBytes,
}: {
  response: Response;
  path: string;
  maximumBytes: number;
}): Promise<void> {
  const writer = Bun.file(path).writer();
  let size = 0;
  try {
    for await (const chunk of response.body!) {
      size += chunk.byteLength;
      if (size > maximumBytes) {
        throw new FaceAnalysisError('Downloaded face model exceeds its size limit.');
      }
      writer.write(chunk);
      await writer.flush();
    }
  } finally {
    await writer.end();
  }
}

export async function prepareFaceModels({
  directory,
  signal,
}: {
  directory: string;
  signal: AbortSignal;
}): Promise<string[]> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const paths: string[] = [];
  for (const model of FACE_MODEL_FILES) {
    const destination = join(directory, `${model.sha256}-${model.name}`);
    const existing = Bun.file(destination);
    if (
      (await existing.exists()) &&
      existing.size <= model.maximumBytes &&
      (await checksum(existing)) === model.sha256
    ) {
      paths.push(destination);
      continue;
    }
    const temporary = `${destination}.${Bun.randomUUIDv7()}.tmp`;
    const response = await fetch(model.url, { signal, redirect: 'error' });
    if (!response.ok || !response.body) {
      throw new FaceAnalysisError(
        'Face models could not be downloaded. Retry when the instance can reach the model host.',
      );
    }
    try {
      await downloadModel({ response, path: temporary, maximumBytes: model.maximumBytes });
      if ((await checksum(Bun.file(temporary))) !== model.sha256) {
        throw new FaceAnalysisError('Downloaded face model failed its integrity check.');
      }
      await rename(temporary, destination);
      paths.push(destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return paths;
}
