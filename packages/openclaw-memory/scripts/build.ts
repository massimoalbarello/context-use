import { chmod, copyFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import metadata from '../package.json';
import { MCP_TOOL_NAMES, PLUGIN_ID, PluginConfigSchema, toolName } from '../src/contract';

const EXECUTABLE_MODE = 0o755;
const JSON_INDENT = 2;
const root = resolve(import.meta.dir, '..');
const output = join(root, 'pkg');
const dist = join(output, 'dist');
await rm(output, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [join(root, 'src/index.ts'), join(root, 'src/setup.ts')],
  outdir: dist,
  target: 'node',
  packages: 'external',
});
if (!result.success) {
  throw new AggregateError(result.logs, 'OpenClaw plugin compilation failed');
}
await chmod(join(dist, 'setup.js'), EXECUTABLE_MODE);
await copyFile(resolve(root, '../../LICENSE'), join(output, 'LICENSE'));
const {
  name,
  version,
  description,
  type,
  license,
  bin,
  openclaw,
  peerDependencies,
  peerDependenciesMeta,
  engines,
  dependencies,
} = metadata;
const publicBin = Object.fromEntries(
  Object.entries(bin).map(([name, path]) => [name, path.replace('./pkg/', './')]),
);
const publicOpenclaw = {
  ...openclaw,
  install: { minHostVersion: peerDependencies.openclaw },
};
await Bun.write(
  join(output, 'package.json'),
  `${JSON.stringify({ name, version, description, type, license, bin: publicBin, openclaw: publicOpenclaw, peerDependencies, peerDependenciesMeta, engines, dependencies }, null, JSON_INDENT)}\n`,
);
await Bun.write(
  join(output, 'openclaw.plugin.json'),
  `${JSON.stringify(
    {
      id: PLUGIN_ID,
      name: 'Context Use Memory',
      description: 'Proactive personal memory in your Context Use instance',
      kind: 'memory',
      categories: ['memory', 'tools'],
      cliCommands: [
        {
          name: 'context-use',
          description: 'Connect, inspect or remove Context Use memory',
          hasSubcommands: true,
        },
      ],
      contracts: { tools: MCP_TOOL_NAMES.map(toolName) },
      configSchema: z.toJSONSchema(PluginConfigSchema),
    },
    null,
    JSON_INDENT,
  )}\n`,
);
