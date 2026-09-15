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
    const registry = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (request.method === 'PUT') {
          const publication = (await request.json()) as {
            versions: Record<string, unknown>;
            'dist-tags': Record<string, string>;
          };
          Object.assign(versions, publication.versions);
          tags = publication['dist-tags'];
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
      expect(await Bun.file(join(root, 'output')).text()).toBe(
        'published=true\npublished=true\npublished=false\n',
      );
    } finally {
      await registry.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  PUBLICATION_TIMEOUT_MS,
);
