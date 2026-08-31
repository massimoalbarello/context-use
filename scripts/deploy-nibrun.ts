const FAILURE_EXIT_CODE = 1;
const BACKEND_BINARY = 'apps/backend/dist/app';

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
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

await run([process.execPath, 'run', 'build']);
await run([nibExecutable, 'run', BACKEND_BINARY, ...Bun.argv.slice(2)]);
