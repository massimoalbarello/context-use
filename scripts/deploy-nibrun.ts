import { randomBytes } from 'node:crypto';
import { BACKEND_BINARY_FILE } from '../apps/backend/scripts/shared/constants';
import {
  BACKEND_ENVIRONMENT,
  DEFAULT_BACKEND_PORT,
  DEFAULT_DATA_FOLDER,
  missingRequiredEnvironmentVariableMessage,
} from '../apps/backend/src/lib/runtime-config';

const FAILURE_EXIT_CODE = 1;
const APP_NAME = 'context-use';
const APP_SLUG_PREFIX = `${APP_NAME}-`;
const AUTH_SECRET_BYTES = 32;
const FAILED_STATUS = 'failed';
const LOG_HISTORY = '8760h';
const MINIMUM_NIB_VERSION = '2026.8.31-2';
const NIB_VERSION_PATTERN = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-(\d+)$/;
const MISSING_AUTH_SECRET_ERROR = missingRequiredEnvironmentVariableMessage(
  BACKEND_ENVIRONMENT.authSecret,
);

type AppListOutput = { apps: { slug: string }[] };
type AppStatusOutput = { status: string };
type LogRecordOutput = { message: string };

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

function supportsStructuredOutput(version: string): boolean {
  return (
    NIB_VERSION_PATTERN.test(version) &&
    version.localeCompare(MINIMUM_NIB_VERSION, 'en', { numeric: true }) >= 0
  );
}

async function requireCompatibleNib(): Promise<void> {
  const installedVersion = (await output([nibExecutable, '--version'])).trim();
  if (supportsStructuredOutput(installedVersion)) {
    return;
  }
  console.error(
    [
      `nib ${installedVersion || 'unknown'} is too old; this deployment requires ${MINIMUM_NIB_VERSION} or newer.`,
      '',
      'Update it with:',
      '  curl -fsSL https://nibrun.com/install.sh | sh',
      '',
      'Then run this deployment command again.',
    ].join('\n'),
  );
  process.exit(FAILURE_EXIT_CODE);
}

function unexpectedJson(command: string[]): never {
  console.error(
    `nib --json ${command.join(' ')} returned an unexpected response; update nib and try again.`,
  );
  process.exit(FAILURE_EXIT_CODE);
}

async function jsonValues<Value>(command: string[]): Promise<Value[]> {
  const serialized = await output([nibExecutable, '--json', ...command]);
  if (!serialized.trim()) {
    return [];
  }
  try {
    return serialized
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as Value);
  } catch {
    return unexpectedJson(command);
  }
}

async function jsonValue<Value>(command: string[]): Promise<Value> {
  const values = await jsonValues<Value>(command);
  const [value] = values;
  return values.length === 1 && value ? value : unexpectedJson(command);
}

async function contextUseApps(): Promise<string[]> {
  const command = ['apps', 'list'];
  const { apps } = await jsonValue<AppListOutput>(command);
  return apps.map((app) => app.slug).filter((slug) => slug.startsWith(APP_SLUG_PREFIX));
}

async function failedForMissingAuthSecret(appSlug: string): Promise<boolean> {
  const statusCommand = ['apps', 'status', '--app', appSlug];
  const { status } = await jsonValue<AppStatusOutput>(statusCommand);
  if (status !== FAILED_STATUS) {
    return false;
  }

  const logsCommand = ['apps', 'logs', '--app', appSlug, '--timerange', LOG_HISTORY];
  return (await jsonValues<LogRecordOutput>(logsCommand)).some((record) =>
    record.message.includes(MISSING_AUTH_SECRET_ERROR),
  );
}

await requireCompatibleNib();

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
const configuredAuthSecret = process.env[BACKEND_ENVIRONMENT.authSecret] || undefined;
const repairingAuthSecret =
  appSlug !== undefined &&
  configuredAuthSecret === undefined &&
  (await failedForMissingAuthSecret(appSlug));
if (repairingAuthSecret) {
  console.log(`Repairing missing ${BACKEND_ENVIRONMENT.authSecret} configuration for ${appSlug}`);
}
// Existing apps retain unnamed environment variables. Generate only for creation or a confirmed
// missing-secret failure; replacing a healthy app's secret would invalidate active sessions.
const authSecret =
  configuredAuthSecret ||
  (appSlug === undefined || repairingAuthSecret
    ? randomBytes(AUTH_SECRET_BYTES).toString('hex')
    : undefined);
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
