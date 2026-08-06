const SENSITIVE_KEY = /(?:secret|password|token|credential|private[_-]?key)/i;

export function redactSensitiveText(input: string): string {
  return input
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^\s@]+(@)/gi, "$1[redacted]$2")
    .replace(/((?:"?(?:[A-Z0-9_.-]*(?:SECRET|PASSWORD|TOKEN|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_.-]*|secretAccessKey|accessKeyId)"?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]");
}

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  quiet?: boolean;
  allowFailure?: boolean;
  signal?: AbortSignal;
};

function abortError(): DOMException {
  return new DOMException("Operation was aborted", "AbortError");
}

export async function run(command: string[], options: RunOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw abortError();
  if (process.env.CONTEXT_USE_DRY_RUN === "1") {
    if (!options.quiet) console.log(`[dry-run] ${command.map((part) => SENSITIVE_KEY.test(part) ? "[redacted]" : part).join(" ")}`);
    return "{}";
  }
  const subprocess = Bun.spawn(command, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    stdin: options.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let aborted = false;
  const onAbort = () => {
    aborted = true;
    subprocess.kill();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  let stdout: string;
  let stderr: string;
  let exitCode: number;
  try {
    if (options.stdin !== undefined) {
      if (!subprocess.stdin) throw new Error("Unable to open command stdin");
      subprocess.stdin.write(options.stdin);
      subprocess.stdin.end();
    }
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
  if (aborted || options.signal?.aborted) throw abortError();
  if (exitCode !== 0 && !options.allowFailure) {
    const safeError = redactSensitiveText(stderr.trim()) || "Command failed without diagnostic output";
    throw new Error(`${command[0]} failed (${exitCode}): ${safeError}`);
  }
  if (!options.quiet && stderr.trim()) console.error(redactSensitiveText(stderr.trim()));
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
