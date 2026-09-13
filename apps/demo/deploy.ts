import { deployToNibrun } from '@repo/pack-utils/deploy-nibrun';

await deployToNibrun({ directory: import.meta.dir, binary: 'dist/context-use-demo' });
