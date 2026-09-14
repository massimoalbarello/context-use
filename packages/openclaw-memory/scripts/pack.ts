import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import metadata from '../package.json';

const root = resolve(import.meta.dir, '..');
const output = join(root, 'release');
await rm(output, { recursive: true, force: true });
await mkdir(output);
const pack = Bun.spawn(
  ['npm', 'pack', './pkg', '--ignore-scripts', '--json', '--pack-destination', output],
  { cwd: root, stdout: 'pipe', stderr: 'inherit' },
);
const stdout = await new Response(pack.stdout).text();
assert.equal(await pack.exited, 0, 'npm pack failed');
const [artifact] = JSON.parse(stdout);
assert.equal(artifact.name, metadata.name);
assert.equal(artifact.version, metadata.version);
assert.deepEqual(
  artifact.files.map((file: { path: string }) => file.path).sort(),
  [
    'LICENSE',
    'dist/bootstrap.js',
    'dist/index.js',
    'dist/setup-prompt.js',
    'dist/setup.js',
    'openclaw.plugin.json',
    'package.json',
  ].sort(),
  'Release must contain only the standalone plugin, setup contract and license',
);
console.log(join(output, artifact.filename));
