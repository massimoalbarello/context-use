type StackCommand = "up" | "down" | "destroy" | "purge" | "reset" | "logs" | "status" | "url";
type ComposeCommand = "up" | "down" | "purge" | "logs" | "status";

export const LOCAL_STACK = {
  project: "context-use-dev",
  database: "context_use",
  url: "http://localhost:5173",
} as const;

const SETUP_TOKEN = "development-owner-setup-token-0000000000000";

function usage(): never {
  console.error("Usage: bun run local <up|down|destroy|purge|reset|logs|status|url>");
  process.exit(1);
}

export function stackUrl(): string {
  return LOCAL_STACK.url;
}

export function setupUrl(): string {
  return `${stackUrl()}/app#setup=${SETUP_TOKEN}`;
}

export function composeArguments(command: ComposeCommand): string[] {
  const prefix = ["compose", "--project-name", LOCAL_STACK.project];
  switch (command) {
    case "up":
      return [...prefix, "up", "--build", "--detach", "--wait"];
    case "down":
      return [...prefix, "down", "--remove-orphans"];
    case "purge":
      return [...prefix, "down", "--volumes", "--remove-orphans"];
    case "logs":
      return [...prefix, "logs", "--follow", "--tail", "100"];
    case "status":
      return [...prefix, "ps"];
  }
}

export function stackVolumeName(volume: "asset-data"): string {
  return `${LOCAL_STACK.project}_${volume}`;
}

function runCompose(arguments_: string[]): void {
  const child = Bun.spawnSync(["docker", "compose", "--project-name", LOCAL_STACK.project, ...arguments_], {
    cwd: import.meta.dir + "/..",
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) process.exit(child.exitCode);
}

function runDocker(command: ComposeCommand): void {
  runCompose(composeArguments(command).slice(3));
}

function removeDataVolume(): void {
  const volume = stackVolumeName("asset-data");
  const listed = Bun.spawnSync(["docker", "volume", "ls", "--quiet", "--filter", `name=^${volume}$`], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (listed.exitCode !== 0) process.exit(listed.exitCode);
  if (listed.stdout.toString().trim() === volume) {
    const removed = Bun.spawnSync(["docker", "volume", "rm", volume], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (removed.exitCode !== 0) process.exit(removed.exitCode);
  }
}

function resetData(restart: boolean): void {
  runDocker("down");
  runCompose(["up", "--detach", "--wait", "postgres"]);
  runCompose([
    "run",
    "--build",
    "--rm",
    "--no-deps",
    "-e",
    "CONTEXT_USE_DEVELOPMENT_RESET=preserve-auth",
    "migrate",
    "bun",
    "--cwd",
    "packages/database",
    "reset:development",
  ]);
  removeDataVolume();
  if (restart) {
    runDocker("up");
    printReady();
  } else {
    runDocker("down");
    console.log("\nKnowledge and assets were removed; owner, passkeys, and OAuth state were preserved.");
  }
}

function printReady(): void {
  console.log("\nContext Use local stack is ready.");
  console.log(`App:   ${stackUrl()}`);
  console.log(`Setup: ${setupUrl()}`);
  console.log(`MCP:   ${stackUrl()}/mcp`);
}

export function runStackCommand(command: StackCommand): void {
  if (command === "url") {
    console.log(stackUrl());
    return;
  }
  if (command === "reset") {
    resetData(true);
    return;
  }
  if (command === "destroy") {
    resetData(false);
    return;
  }
  runDocker(command);
  if (command === "up") printReady();
}

if (import.meta.main) {
  const [rawCommand] = process.argv.slice(2);
  if (!rawCommand
    || !(["up", "down", "destroy", "purge", "reset", "logs", "status", "url"] as string[]).includes(rawCommand)) {
    usage();
  }
  runStackCommand(rawCommand as StackCommand);
}
