import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKEND_BUILD_TARGET } from '../scripts/shared/constants';
import { seedDemoSnapshot } from './seed';

const output = join(import.meta.dir, 'dist');
const snapshot = join(output, 'demo-seed');
const frontend = join(import.meta.dir, '../../frontend/demo/dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
try {
  await seedDemoSnapshot({ dataFolder: snapshot });
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'main.ts')],
    compile: {
      outfile: join(output, 'context-use-demo'),
      ...(BACKEND_BUILD_TARGET ? { target: BACKEND_BUILD_TARGET } : {}),
      assets: [frontend, snapshot],
    },
    bytecode: true,
    format: 'esm',
    naming: { asset: '[dir]/[name].[ext]' },
    define: { PUBLIC_FRONTEND_DIR_NAME: JSON.stringify('dist') },
    minify: { whitespace: true, syntax: true },
    target: 'bun',
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Demo compilation failed');
  }
  console.log(`Built ${join(output, 'context-use-demo')}`);
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
