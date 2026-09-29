import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { imageSize } from 'image-size';

const MAX_EDGE = 1280;
const TEST_TIMEOUT_MS = 60_000;

test(
  'compiled media helper handles extensionless images and video without host tools',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'context-use-media-binary-'));
    try {
      const source = join(directory, 'preview.ts');
      const executable = join(directory, 'preview');
      const processor = resolve(import.meta.dir, '../backend/src/lib/media-preview/processor.ts');
      await Bun.write(
        source,
        `
      import { LocalMediaPreviewProcessor } from ${JSON.stringify(processor)};
      const processor = new LocalMediaPreviewProcessor(Bun.argv[4]);
      const result = await processor.generate({ blob: Bun.file(Bun.argv[2]), signal: new AbortController().signal });
      await Bun.write(Bun.argv[3], result.blob);
      console.log(JSON.stringify({ width: result.width, height: result.height }));
    `,
      );
      const build = await Bun.build({
        entrypoints: [source],
        compile: {
          outfile: executable,
          assets: [resolve(import.meta.dir, '../dist/instance/media-engine')],
        },
        naming: { asset: '[dir]/[name].[ext]' },
      });
      expect(build.success, JSON.stringify(build.logs)).toBe(true);
      for (const name of ['iphone.jpg', 'apple.png', 'synthetic-iphone-rehearsal.mp4']) {
        const input = Bun.file(resolve(import.meta.dir, '../demo/fixtures/assets', name));
        const output = join(directory, `${name}.webp`);
        const child = Bun.spawn([executable, input.name!, output, join(directory, 'engine')], {
          cwd: directory,
          env: { PATH: '' },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, stderr).toBe(0);
        const dimensions = JSON.parse(stdout);
        expect(dimensions.width).toBeGreaterThan(0);
        expect(dimensions.width).toBeLessThanOrEqual(MAX_EDGE);
        expect(dimensions.height).toBeGreaterThan(0);
        expect(dimensions.height).toBeLessThanOrEqual(MAX_EDGE);
        const preview = Bun.file(output);
        expect(imageSize(await preview.bytes())).toMatchObject({ ...dimensions, type: 'webp' });
        expect(preview.size).toBeLessThan(input.size);
      }
      let requests = 0;
      const server = Bun.serve({
        port: 0,
        fetch: () => {
          requests++;
          return new Response('Unexpected media request');
        },
      });
      try {
        const playlist = join(directory, 'playlist');
        await Bun.write(
          playlist,
          `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${server.url}video.ts\n#EXT-X-ENDLIST\n`,
        );
        const child = Bun.spawn(
          [executable, playlist, join(directory, 'blocked.webp'), join(directory, 'engine')],
          {
            env: { PATH: '' },
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
          },
        );
        expect(await child.exited).not.toBe(0);
        expect(requests).toBe(0);
      } finally {
        await server.stop(true);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
