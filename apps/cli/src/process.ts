const REDACT = /(?:secret|password|token|credential|private[_-]?key)/i;

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  quiet?: boolean;
  allowFailure?: boolean;
};

export async function run(command: string[], options: RunOptions = {}): Promise<string> {
  if (process.env.CONTEXT_USE_DRY_RUN === "1") {
    if (!options.quiet) console.log(`[dry-run] ${command.map((part) => REDACT.test(part) ? "[redacted]" : part).join(" ")}`);
    return "{}";
  }
  const subprocess = Bun.spawn(command, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    stdin: options.stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin) {
    if (!subprocess.stdin) throw new Error("Unable to open command stdin");
    subprocess.stdin.write(options.stdin);
    subprocess.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    const safeError = REDACT.test(stderr) ? "Command failed; sensitive output was redacted" : stderr.trim();
    throw new Error(`${command[0]} failed (${exitCode}): ${safeError}`);
  }
  if (!options.quiet && stderr.trim() && !REDACT.test(stderr)) console.error(stderr.trim());
  return stdout.trim();
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await run([command, "--version"], { quiet: true });
    return true;
  } catch {
    return false;
  }
}
