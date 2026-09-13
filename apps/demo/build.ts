import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKEND_BUILD_TARGET } from '@repo/backend/build-target';
import { LocalFaceAnalyzer } from '@repo/backend/lib/face-analysis/local-analyzer';
import { seedDemoSnapshot } from './seed';

const output = join(import.meta.dir, 'dist');
const snapshot = join(output, 'demo-seed');
const frontend = join(output, 'public');
// Keep downloaded models outside the snapshot embedded in the public binary.
const analyzer = new LocalFaceAnalyzer({
  dataFolder: join(import.meta.dir, '.cache/faces'),
});
await rm(snapshot, { recursive: true, force: true });
await mkdir(output, { recursive: true });
try {
  await seedDemoSnapshot({ dataFolder: snapshot, analyzer });
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
    define: { PUBLIC_FRONTEND_DIR_NAME: JSON.stringify('public') },
    minify: { whitespace: true, syntax: true },
    target: 'bun',
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Demo compilation failed');
  }
  console.log(`Built ${join(output, 'context-use-demo')}`);
} finally {
  await analyzer.close();
  await rm(snapshot, { recursive: true, force: true });
}
