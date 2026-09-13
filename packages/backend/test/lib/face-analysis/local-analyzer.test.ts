import { expect, test } from 'bun:test';
import { chmod, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LocalFaceAnalyzer } from '#lib/face-analysis/local-analyzer.ts';
import { LOCAL_FACE_MODEL } from '#lib/face-analysis/models.ts';

const backend = resolve(import.meta.dir, '../../..');
const detector = 'fixture detector';
const recognizer = 'fixture recognizer';
const EXECUTABLE_MODE = 0o700;

async function fixture(fetch: (request: Request) => Response | Promise<Response>) {
  const root = await mkdtemp(join(tmpdir(), 'context-use-face-preparation-'));
  const source = join(root, 'src/lib/face-analysis');
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch });
  const engineStarts = join(root, 'engine-starts');
  try {
    await cp(join(backend, 'src/lib/face-analysis'), source, { recursive: true });
    await symlink(join(backend, 'node_modules'), join(root, 'node_modules'));
    await symlink(join(backend, 'src/models'), join(root, 'src/models'));
    await Bun.write(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module', imports: { '#*': './src/*' } }),
    );
    // Substitute the external model files and native executable, keeping the real download,
    // filesystem, preparation lifecycle, and subprocess protocol boundaries.
    await Bun.write(
      join(source, 'models.ts'),
      `export const LOCAL_FACE_MODEL = ${JSON.stringify(LOCAL_FACE_MODEL)};
  export const FACE_MODEL_FILES = ${JSON.stringify(
    Array.from([detector, recognizer].entries(), ([index, content]) => ({
      name: `${index}.onnx`,
      url: new URL(String(index), server.url).href,
      sha256: new Bun.CryptoHasher('sha256').update(content).digest('hex'),
      maximumBytes: 100,
    })),
  )};`,
    );
    const binary = join(root, '.cache/face-engine-host/face-analyzer');
    await Bun.write(
      binary,
      String.raw`#!${process.execPath}
  import { appendFileSync } from 'node:fs';
  appendFileSync(${JSON.stringify(engineStarts)}, 'started\n');
  console.log(JSON.stringify({ ready: true }));
  for await (const chunk of Bun.stdin.stream()) {
    if (new TextDecoder().decode(chunk).includes('\n')) console.log(JSON.stringify({ faces: [] }));
  }`,
    );
    await chmod(binary, EXECUTABLE_MODE);
    const { LocalFaceAnalyzer: Analyzer } = (await import(join(source, 'local-analyzer.ts'))) as {
      LocalFaceAnalyzer: typeof LocalFaceAnalyzer;
    };
    const analyzer = new Analyzer({ dataFolder: join(root, 'data') });
    return {
      analyzer,
      engineStarts,
      reopen: () => new Analyzer({ dataFolder: join(root, 'data') }),
      async close() {
        await analyzer.close();
        await server.stop(true);
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function imageRequest(signal = new AbortController().signal) {
  return { ownerId: 'owner', image: new Blob(['fixture image']), signal };
}

test('background preparation shares downloads with the first image and reuses files after restart', async () => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const requests: string[] = [];
  const context = await fixture(async (request) => {
    const path = new URL(request.url).pathname;
    requests.push(path);
    requested.resolve();
    await release.promise;
    return new Response(path === '/0' ? detector : recognizer);
  });
  try {
    const preparing = context.analyzer.prepare();
    await requested.promise;
    expect(await Bun.file(context.engineStarts).exists()).toBe(false);
    const processing = context.analyzer.analyze(imageRequest());
    release.resolve();
    await preparing;
    expect(await processing).toMatchObject({ model: LOCAL_FACE_MODEL, faces: [] });
    expect(await context.analyzer.analyze(imageRequest())).toMatchObject({
      model: LOCAL_FACE_MODEL,
      faces: [],
    });
    expect(await Bun.file(context.engineStarts).text()).toBe('started\nstarted\n');
    expect(requests).toEqual(['/0', '/1']);
    await context.analyzer.close();
    const reopened = context.reopen();
    try {
      await reopened.prepare();
      expect(requests).toEqual(['/0', '/1']);
      expect(await Bun.file(context.engineStarts).text()).toBe('started\nstarted\n');
    } finally {
      await reopened.close();
    }
  } finally {
    release.resolve();
    await context.close();
  }
});

test('a failed background download can be retried by image processing', async () => {
  let fail = true;
  const context = await fixture((request) =>
    fail
      ? new Response('Unavailable', { status: 503 })
      : new Response(new URL(request.url).pathname === '/0' ? detector : recognizer),
  );
  try {
    await expect(context.analyzer.prepare()).rejects.toThrow('could not be downloaded');
    fail = false;
    expect(await context.analyzer.analyze(imageRequest())).toMatchObject({
      model: LOCAL_FACE_MODEL,
      faces: [],
    });
  } finally {
    await context.close();
  }
});

test('canceling an image leaves shared preparation running; shutdown cancels the download', async () => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const context = await fixture(async () => {
    requested.resolve();
    await release.promise;
    return new Response(detector);
  });
  try {
    const preparing = context.analyzer.prepare();
    let preparationFailed = false;
    const stopped = preparing.catch((error: unknown) => {
      preparationFailed = true;
      return error;
    });
    await requested.promise;
    const controller = new AbortController();
    const processing = context.analyzer.analyze(imageRequest(controller.signal));
    const canceled = processing.catch((error: unknown) => error);
    controller.abort();
    expect(await canceled).toBeInstanceOf(Error);
    expect(preparationFailed).toBe(false);
    expect(await Bun.file(context.engineStarts).exists()).toBe(false);
    await context.analyzer.close();
    expect(await stopped).toBeInstanceOf(Error);
  } finally {
    release.resolve();
    await context.close();
  }
});
