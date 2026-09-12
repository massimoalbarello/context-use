import { resolve } from 'node:path';
import { $ } from 'bun';
import { DEFAULT_BUILD_TARGET } from '../scripts/shared/constants';
import { DEFAULT_BACKEND_PORT } from '../src/lib/runtime-config';

const APP_NAME = 'steve-jobs-demo';

export function demoDeploymentTarget(apps: { slug: string }[]): string[] {
  const matching = apps.filter(({ slug }) => slug === APP_NAME || slug.startsWith(`${APP_NAME}-`));
  if (matching.length > 1) {
    throw new Error(
      `Multiple Steve Jobs demos found: ${matching.map(({ slug }) => slug).join(', ')}`,
    );
  }
  return matching[0] ? ['--app', matching[0].slug] : ['--name', APP_NAME];
}

if (import.meta.main) {
  const nib = Bun.which('nib');
  if (!nib) {
    throw new Error('Install the nibrun CLI and run `nib login`, then retry this command.');
  }
  const { apps }: { apps: { slug: string }[] } = await $`${nib} --json apps list`.json();
  const target = demoDeploymentTarget(apps);
  const root = resolve(import.meta.dir, '../../..');
  const binary = resolve(import.meta.dir, 'dist/context-use-demo');

  await $`${process.execPath} run demo:build`
    .cwd(root)
    .env({ ...process.env, BUILD_TARGET: DEFAULT_BUILD_TARGET });
  await $`${nib} run ${binary} ${target} --port ${DEFAULT_BACKEND_PORT}`.cwd(root);
}
