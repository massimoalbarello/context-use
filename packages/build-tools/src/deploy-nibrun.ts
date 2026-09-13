import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { $ } from 'bun';

const NIBRUN_BUILD_TARGET = 'bun-linux-x64';
const NIBRUN_PORT = 3000;
const MAX_APP_NAME_STEM_LENGTH = 56;
const GENERATED_SLUG_SUFFIX = /-[0-9abcdefghjkmnpqrstvwxyz]{6}$/;

export function deploymentTarget(args: string[]): ['--app' | '--name', string] {
  const { values } = parseArgs({
    args,
    options: { app: { type: 'string' }, new: { type: 'string' } },
    allowPositionals: false,
  });
  if (
    (values.app !== undefined && !values.app.trim()) ||
    (values.new !== undefined && !values.new.trim()) ||
    (values.app !== undefined) === (values.new !== undefined)
  ) {
    throw new Error(
      'Choose --new <app-name> to create an app or --app <name-or-slug> to redeploy.',
    );
  }
  return values.app ? ['--app', values.app] : ['--name', values.new!];
}

function appNameStem(name: string): string {
  // Match nibrun's name-to-slug contract; the CLI lists only slugs, not original names.
  // https://github.com/ilbertt/nibrun/blob/main/apps/api/src/lib/app-slug.ts
  const stem = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!stem || stem.startsWith('xn--')) {
    return 'app';
  }
  return stem.slice(0, MAX_APP_NAME_STEM_LENGTH).replace(/-+$/g, '');
}

function appSlugs(listing: unknown): string[] {
  const invalid = () =>
    new Error('Invalid response from `nib --json apps list`; deployment stopped.');
  if (
    !listing ||
    typeof listing !== 'object' ||
    !('apps' in listing) ||
    !Array.isArray(listing.apps)
  ) {
    throw invalid();
  }
  return listing.apps.map((app: unknown) => {
    if (
      !app ||
      typeof app !== 'object' ||
      !('slug' in app) ||
      typeof app.slug !== 'string' ||
      !app.slug.trim()
    ) {
      throw invalid();
    }
    return app.slug;
  });
}

async function resolveAppSlug({ nib, requested }: { nib: string; requested: string }) {
  const slugs = appSlugs(await $`${nib} --json apps list`.json());
  if (slugs.includes(requested)) {
    return requested;
  }
  const name = appNameStem(requested);
  const matches = slugs.filter(
    (slug) => GENERATED_SLUG_SUFFIX.test(slug) && slug.replace(GENERATED_SLUG_SUFFIX, '') === name,
  );
  if (matches.length === 0) {
    throw new Error(
      `No nibrun app matches "${requested}". Run \`nib apps list\` and specify --app <exact-slug>, or use --new <app-name> to create one.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple nibrun apps match "${requested}". Specify which one to redeploy with an exact slug:\n${matches.map((slug) => `  --app ${slug}`).join('\n')}`,
    );
  }
  console.log(`Resolved nibrun app "${requested}" to ${matches[0]}`);
  return matches[0]!;
}

export async function deployToNibrun({
  directory,
  binary,
  task,
}: {
  directory: string;
  binary: string;
  task: string;
}) {
  const target = deploymentTarget(Bun.argv.slice(2));
  const nib = Bun.which('nib');
  if (!nib) {
    throw new Error('Install the nibrun CLI and run `nib login`, then retry this command.');
  }
  if (target[0] === '--app') {
    target[1] = await resolveAppSlug({ nib, requested: target[1] });
  }
  const { name }: { name: string } = await Bun.file(join(directory, 'package.json')).json();
  const build = await $`${process.execPath} run --bun turbo ${task} ${`--filter=${name}`}`
    .cwd(directory)
    .env({ ...process.env, BUILD_TARGET: NIBRUN_BUILD_TARGET })
    .nothrow();
  if (build.exitCode !== 0) {
    console.error(`Deployment stopped: ${task} failed. See the build error above.`);
    process.exitCode = build.exitCode;
    return;
  }
  await $`${nib} run ${join(directory, binary)} ${target} --port ${NIBRUN_PORT}`.cwd(directory);
}
