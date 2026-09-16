import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export async function hasPublishedChanges({
  spec,
  version,
}: {
  spec: string;
  version: string;
}): Promise<boolean> {
  const directory = await mkdtemp(join(tmpdir(), 'context-use-release-compare-'));
  try {
    const output = join(directory, 'pkg');
    // Compare at the published version: the generated version is embedded in JS too.
    execFileSync(process.execPath, [resolve(import.meta.dir, 'build.ts'), output, version]);
    const [published] = JSON.parse(
      execFileSync(
        'npm',
        ['pack', spec, '--ignore-scripts', '--json', '--pack-destination', directory],
        {
          encoding: 'utf8',
        },
      ),
    ) as [{ filename: string; files: { path: string; mode: number }[] }];
    const files = await Array.fromAsync(
      new Bun.Glob('**/*').scan({ cwd: output, onlyFiles: true }),
    );
    if (files.length !== published.files.length) {
      return true;
    }
    for (const file of published.files) {
      if (!files.includes(file.path)) {
        return true;
      }
      const path = join(output, file.path);
      const contents = execFileSync('tar', [
        '-xOf',
        join(directory, published.filename),
        `package/${file.path}`,
      ]);
      if (!contents.equals(await readFile(path))) {
        return true;
      }
      // npm normalizes permissions; only executable bits affect the installed package.
      if (((await stat(path)).mode & 0o111) !== (file.mode & 0o111)) {
        return true;
      }
    }
    return false;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
