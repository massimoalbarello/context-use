import { join } from 'node:path';

const buildTarget = process.env.BUILD_TARGET || 'bun-linux-x64';
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, '../src/server.ts')],
  compile: {
    outfile: join(import.meta.dir, '../dist/context-use-landing'),
    ...(buildTarget === 'host' ? {} : { target: buildTarget as Bun.Build.CompileTarget }),
    assets: [join(import.meta.dir, '../dist/public')],
  },
  bytecode: true,
  format: 'esm',
  naming: { asset: '[dir]/[name].[ext]' },
  minify: { whitespace: true, syntax: true },
  target: 'bun',
});

if (!result.success) {
  throw new AggregateError(result.logs, 'Landing page compilation failed');
}
console.log(`Built ${join(import.meta.dir, '../dist/context-use-landing')}`);
