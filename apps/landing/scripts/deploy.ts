import { resolve } from 'node:path';
import { deployToNibrun } from '@repo/build-tools/deploy-nibrun';

await deployToNibrun({
  directory: resolve(import.meta.dir, '..'),
  binary: 'dist/context-use-landing',
  task: 'build',
});
