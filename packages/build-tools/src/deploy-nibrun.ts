import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { $ } from 'bun';

const NIBRUN_BUILD_TARGET = 'bun-linux-x64';
const NIBRUN_PORT = 3000;

export function deploymentTarget(args: string[]): string[] {
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
      'Choose --new <app-name> to create an app or --app <existing-slug> to redeploy.',
    );
  }
  return values.app ? ['--app', values.app] : ['--name', values.new!];
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
  const { name }: { name: string } = await Bun.file(join(directory, 'package.json')).json();
  await $`${process.execPath} run --bun turbo ${task} ${`--filter=${name}`}`
    .cwd(directory)
    .env({ ...process.env, BUILD_TARGET: NIBRUN_BUILD_TARGET });
  await $`${nib} run ${join(directory, binary)} ${target} --port ${NIBRUN_PORT}`.cwd(directory);
}
