import { randomBytes } from 'node:crypto';
import { BACKEND_BINARY_FILE } from '../apps/backend/scripts/shared/constants';
import {
  BACKEND_ENVIRONMENT,
  DEFAULT_BACKEND_PORT,
  DEFAULT_DATA_FOLDER,
} from '../apps/backend/src/lib/runtime-config';

const FAILURE_EXIT_CODE = 1;
const APP_NAME = 'context-use';
const APP_SLUG_PREFIX = `${APP_NAME}-`;
const AUTH_SECRET_BYTES = 32;

type AppListOutput = { apps: { slug: string }[] };

const nibExecutable = Bun.which('nib');
if (!nibExecutable) {
  console.error(
    [
      'The nibrun CLI (`nib`) is required but was not found on PATH.',
      '',
      'Install it and sign in:',
      '  curl -fsSL https://nibrun.com/install.sh | sh',
      '  nib login',
      '',
      'Then run this deployment command again.',
    ].join('\n'),
  );
  process.exit(FAILURE_EXIT_CODE);
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function output(command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const result = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
  return result;
}

function unexpectedJson(command: string[]): never {
  console.error(
    `nib --json ${command.join(' ')} returned an unexpected response; update nib and try again.`,
  );
  process.exit(FAILURE_EXIT_CODE);
}

async function jsonValue<Value>(command: string[]): Promise<Value> {
  const serialized = await output([nibExecutable, '--json', ...command]);
  const lines = serialized.trim().split('\n');
  const [line] = lines;
  if (lines.length !== 1 || !line) {
    return unexpectedJson(command);
  }
  try {
    return JSON.parse(line) as Value;
  } catch {
    return unexpectedJson(command);
  }
}

async function contextUseApps(): Promise<string[]> {
  const command = ['apps', 'list'];
  const { apps } = await jsonValue<AppListOutput>(command);
  return apps.map((app) => app.slug).filter((slug) => slug.startsWith(APP_SLUG_PREFIX));
}

const matchingApps = await contextUseApps();
if (matchingApps.length > 1) {
  console.error(
    [
      'Found multiple Context Use apps on nibrun:',
      ...matchingApps.map((slug) => `  ${slug}`),
      '',
      'Remove the duplicates before deploying so the target is unambiguous.',
    ].join('\n'),
  );
  process.exit(FAILURE_EXIT_CODE);
}

const [appSlug] = matchingApps;
const authSecret =
  appSlug === undefined
    ? process.env[BACKEND_ENVIRONMENT.authSecret] || randomBytes(AUTH_SECRET_BYTES).toString('hex')
    : undefined;
const environment = [
  '--env',
  `${BACKEND_ENVIRONMENT.dataFolder}=${DEFAULT_DATA_FOLDER}`,
  ...(authSecret === undefined ? [] : ['--env', `${BACKEND_ENVIRONMENT.authSecret}=${authSecret}`]),
];
const target = appSlug ? ['--app', appSlug, ...environment] : ['--name', APP_NAME, ...environment];

await run([process.execPath, 'run', 'build']);
await run([
  nibExecutable,
  'run',
  BACKEND_BINARY_FILE,
  ...target,
  '--port',
  String(DEFAULT_BACKEND_PORT),
]);
