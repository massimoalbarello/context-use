import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
    const changes = execFileSync(
      'npm',
      ['diff', '--diff', spec, '--diff', output, '--diff-name-only', '--ignore-scripts'],
      { cwd: directory, encoding: 'utf8' },
    );
    return changes.trim().length > 0;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
