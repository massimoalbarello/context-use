import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  faceEngineDirectory as builtFaceEngineDirectory,
  migrationDirectory,
} from '@repo/backend/build-assets';
import { BACKEND_BUILD_TARGET } from '@repo/backend/build-target';

const output = join(import.meta.dir, 'dist');
const faceEngineDirectory = join(output, 'face-engine');
await rm(faceEngineDirectory, { recursive: true, force: true });
await cp(builtFaceEngineDirectory({ host: !BACKEND_BUILD_TARGET }), faceEngineDirectory, {
  recursive: true,
});
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, 'main.ts')],
  compile: {
    outfile: join(output, 'context-use'),
    execArgv: ['--smol'],
    ...(BACKEND_BUILD_TARGET ? { target: BACKEND_BUILD_TARGET } : {}),
    assets: [join(output, 'public'), migrationDirectory, faceEngineDirectory],
  },
  bytecode: true,
  format: 'esm',
  naming: { asset: '[dir]/[name].[ext]' },
  define: {
    PUBLIC_FRONTEND_DIR_NAME: JSON.stringify('public'),
    DB_MIGRATIONS_DIR_NAME: JSON.stringify('migrations'),
  },
  minify: { whitespace: true, syntax: true },
  target: 'bun',
});
if (!result.success) {
  throw new AggregateError(result.logs, 'Context Use compilation failed');
}
console.log(`Built ${join(output, 'context-use')}`);
