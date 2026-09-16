import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import metadata from '../package.json';

const PUBLICATION_TIMEOUT_MS = 30_000;

test(
  'npm publication retries identical artifacts and never overwrites a release or rolls beta back',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'context-use-publish-'));
    const versions: Record<string, unknown> = {};
    let tags: Record<string, string> = {};
    let publications = 0;
    const tarballs = new Map<string, Buffer>();
    const registry = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith('.tgz')) {
          const contents = tarballs.get(new URL(request.url).pathname.split('/').at(-1)!);
          return contents ? new Response(contents) : new Response('Not found', { status: 404 });
        }
        if (request.method === 'PUT') {
          const publication = (await request.json()) as {
            versions: Record<string, unknown>;
            'dist-tags': Record<string, string>;
            _attachments: Record<string, { data: string }>;
          };
          Object.assign(versions, publication.versions);
          tags = publication['dist-tags'];
          for (const [name, attachment] of Object.entries(publication._attachments)) {
            tarballs.set(name.split('/').at(-1)!, Buffer.from(attachment.data, 'base64'));
          }
          publications++;
          return Response.json({ ok: true });
        }
        return Object.keys(versions).length
          ? Response.json({ name: metadata.name, versions, 'dist-tags': tags })
          : Response.json({ error: 'Not found' }, { status: 404 });
      },
    });
    try {
      const npmrc = join(root, '.npmrc');
      await writeFile(npmrc, `//127.0.0.1:${registry.port}/:_authToken=test-only\n`);
      async function publish({
        version,
        description = 'release fixture',
      }: {
        version: string;
        description?: string;
      }) {
        const packageDirectory = join(root, 'package');
        await mkdir(packageDirectory, { recursive: true });
        await writeFile(
          join(packageDirectory, 'package.json'),
          JSON.stringify({ name: metadata.name, version, description }),
        );
        const artifact = join(root, 'release.tgz');
        execFileSync('tar', ['-czf', artifact, '-C', root, 'package']);
        return run(artifact);
      }
      async function run(artifact: string) {
        const child = Bun.spawn(
          [process.execPath, resolve(import.meta.dir, '../scripts/publish.ts'), artifact],
          {
            env: {
              ...process.env,
              GITHUB_OUTPUT: join(root, 'output'),
              npm_config_registry: registry.url.href,
              npm_config_userconfig: npmrc,
              npm_config_cache: join(root, 'npm-cache'),
              npm_config_fetch_retries: '0',
            },
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, output: stdout + stderr };
      }

      expect(await publish({ version: '0.1.0-beta.2' })).toMatchObject({ exitCode: 0 });
      expect(publications).toBe(1);
      const retry = await run(join(root, 'release.tgz'));
      expect(retry).toMatchObject({ exitCode: 0 });
      expect(retry.output).toContain('already published with the verified contents');
      const collision = await publish({
        version: '0.1.0-beta.2',
        description: 'different contents',
      });
      expect(collision.exitCode).not.toBe(0);
      expect(collision.output).toContain('already exists with different contents');
      const older = await publish({ version: '0.1.0-beta.1' });
      expect(older).toMatchObject({ exitCode: 0 });
      expect(older.output).toContain('already points to newer version');
      expect(publications).toBe(1);
      expect(tags.beta).toBe('0.1.0-beta.2');
      expect(
        (await Bun.file(join(root, 'output')).text())
          .split('\n')
          .filter((line) => line.startsWith('published=')),
      ).toEqual(['published=true', 'published=true', 'published=false']);

      // Use the real build and pack boundaries, including versions embedded in JS.
      function publishBuiltPackage(version: string) {
        execFileSync(process.execPath, [
          resolve(import.meta.dir, '../scripts/build.ts'),
          join(root, 'package'),
          version,
        ]);
        const [artifact] = JSON.parse(
          execFileSync(
            'npm',
            [
              'pack',
              join(root, 'package'),
              '--ignore-scripts',
              '--json',
              '--pack-destination',
              root,
            ],
            { encoding: 'utf8' },
          ),
        );
        return run(join(root, artifact.filename));
      }
      expect(await publishBuiltPackage('0.1.0-beta.3')).toMatchObject({ exitCode: 0 });
      expect(publications).toBe(2);
      const unchanged = await publishBuiltPackage('0.1.0-beta.4');
      expect(unchanged).toMatchObject({ exitCode: 0 });
      expect(unchanged.output).toContain('packaged contents are unchanged');
      expect(publications).toBe(2);
      expect(tags.beta).toBe('0.1.0-beta.3');
    } finally {
      await registry.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  PUBLICATION_TIMEOUT_MS,
);
