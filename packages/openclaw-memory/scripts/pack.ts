import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import metadata from '../package.json';
import { SETUP_SKILL } from '../src/setup-skill';

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
    'dist/remove-worker.js',
    'dist/setup-prompt.js',
    'dist/setup-runtime.js',
    'dist/setup.js',
    'openclaw.plugin.json',
    'package.json',
    'skills/context-use/SKILL.md',
  ].sort(),
  'Release must contain only the standalone plugin, setup skill, setup contract and license',
);
const manifest = await Bun.file(join(root, 'pkg/openclaw.plugin.json')).json();
const skillFile = join(root, 'pkg', manifest.skills[0], 'context-use/SKILL.md');
assert.equal(await Bun.file(skillFile).text(), SETUP_SKILL);
const instructions = Bun.spawn(
  [process.execPath, join(root, 'pkg/dist/bootstrap.js'), 'instructions'],
  { env: { PATH: output }, stdout: 'pipe', stderr: 'inherit' },
);
assert.equal(await new Response(instructions.stdout).text(), `${SETUP_SKILL}\n`);
assert.equal(
  await instructions.exited,
  0,
  'Instructions must work without an OpenClaw installation',
);
console.log(join(output, artifact.filename));
