import { randomBytes } from 'node:crypto';

const FAILURE_EXIT_CODE = 1;
const BACKEND_BINARY = 'apps/backend/dist/app';
const APP_NAME = 'context-use';
const APP_PORT = '3000';
const APP_SLUG_PATTERN = /^context-use-[a-z0-9]{6}$/;
const AUTH_SECRET_BYTES = 32;
const FAILED_STATUS = 'failed';
const LOG_HISTORY = '8760h';
const MISSING_AUTH_SECRET_ERROR = 'Missing required environment variable: BETTER_AUTH_SECRET';

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

// `nib apps list` has no structured-output option. Piping it produces a plain table whose first
// column is the immutable app slug, so only exact Context Use slug shapes are accepted here.
function contextUseApps(listing: string): string[] {
  return listing
    .split('\n')
    .map((line) => line.trim().split(/\s+/, 1)[0])
    .filter((slug): slug is string => slug !== undefined && APP_SLUG_PATTERN.test(slug));
}

async function failedForMissingAuthSecret(appSlug: string): Promise<boolean> {
  const status = await output([nibExecutable, 'apps', 'status', '--app', appSlug]);
  if (status.split('\n', 1)[0] !== `${appSlug}  ${FAILED_STATUS}`) {
    return false;
  }

  const child = Bun.spawn(
    [nibExecutable, 'apps', 'logs', '--app', appSlug, '--timerange', LOG_HISTORY],
    {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exit(exitCode);
  }
  return stdout.includes(MISSING_AUTH_SECRET_ERROR) || stderr.includes(MISSING_AUTH_SECRET_ERROR);
}

const matchingApps = contextUseApps(await output([nibExecutable, 'apps', 'list']));
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
const configuredAuthSecret = process.env.BETTER_AUTH_SECRET || undefined;
const repairingAuthSecret =
  appSlug !== undefined &&
  configuredAuthSecret === undefined &&
  (await failedForMissingAuthSecret(appSlug));
if (repairingAuthSecret) {
  console.log(`Repairing missing BETTER_AUTH_SECRET configuration for ${appSlug}`);
}
// Existing apps retain unnamed environment variables. Generate only for creation or a confirmed
// missing-secret failure; replacing a healthy app's secret would invalidate active sessions.
const authSecret =
  configuredAuthSecret ||
  (appSlug === undefined || repairingAuthSecret
    ? randomBytes(AUTH_SECRET_BYTES).toString('hex')
    : undefined);
const environment = authSecret === undefined ? [] : ['--env', `BETTER_AUTH_SECRET=${authSecret}`];
const target = appSlug ? ['--app', appSlug, ...environment] : ['--name', APP_NAME, ...environment];

await run([process.execPath, 'run', 'build']);
await run([nibExecutable, 'run', BACKEND_BINARY, ...target, '--port', APP_PORT]);
