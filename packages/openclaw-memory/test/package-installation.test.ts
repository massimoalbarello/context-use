import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('setup resolves the host SDK even when the external plugin has a newer peer copy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-host-sdk-'));
  try {
    const external = join(directory, 'external');
    const host = join(directory, 'host/node_modules/openclaw');
    const foreign = join(external, 'node_modules/openclaw');
    const bundled = join(host, 'dist/extensions/memory-core');
    const bin = join(directory, 'bin');
    for (const root of [host, foreign, bundled, bin]) {
      await mkdir(root, { recursive: true });
    }
    for (const root of [host, foreign]) {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'openclaw',
          exports: { './plugin-sdk/config-mutation': './sdk.js' },
        }),
      );
      await writeFile(join(root, 'sdk.js'), '');
    }
    const inventory = JSON.stringify({
      plugins: [
        { id: 'context-use', rootDir: external, origin: 'global' },
        { id: 'memory-core', rootDir: bundled, origin: 'bundled' },
      ],
    });
    await writeFile(
      join(bin, 'openclaw'),
      `#!/bin/sh\ncat <<'INVENTORY'\n${inventory}\nINVENTORY\n`,
    );
    const executableMode = 0o700;
    await chmod(join(bin, 'openclaw'), executableMode);
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import {hostSdkAnchor} from ${JSON.stringify(resolve(import.meta.dir, '../src/package-installation.ts'))}; console.log(await hostSdkAnchor());`,
      ],
      {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(await child.exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe(
      await realpath(join(host, 'sdk.js')),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
