type StackName = "local" | "eval";
type StackCommand = "up" | "down" | "destroy" | "purge" | "reset" | "logs" | "status" | "url";
type ComposeCommand = "up" | "down" | "purge" | "logs" | "status";

type StackConfiguration = {
  project: string;
  database: string;
  webPort: string;
  postgresPort: string;
  ownerEmail: string;
};

const STACKS: Record<StackName, StackConfiguration> = {
  local: {
    project: "context-use-dev",
    database: "context_use",
    webPort: "5173",
    postgresPort: "5432",
    ownerEmail: "you@example.com",
  },
  eval: {
    project: "context-use-eval",
    database: "context_use_eval",
    webPort: "5273",
    postgresPort: "55432",
    ownerEmail: "eval@example.com",
  },
};

const SETUP_TOKEN = "development-owner-setup-token-0000000000000";

function usage(): never {
  console.error("Usage: bun run <local|eval> <up|down|destroy|purge|reset|logs|status|url>");
  process.exit(1);
}

export function stackConfiguration(name: StackName): StackConfiguration {
  return STACKS[name];
}

export function stackEnvironment(name: StackName): Record<string, string> {
  const stack = stackConfiguration(name);
  return {
    CONTEXT_USE_COMPOSE_PROJECT: stack.project,
    CONTEXT_USE_DB_NAME: stack.database,
    CONTEXT_USE_WEB_PORT: stack.webPort,
    CONTEXT_USE_POSTGRES_PORT: stack.postgresPort,
    OWNER_EMAIL: stack.ownerEmail,
  };
}

export function stackUrl(name: StackName): string {
  return `http://localhost:${stackConfiguration(name).webPort}`;
}

export function setupUrl(name: StackName): string {
  return `${stackUrl(name)}/app#setup=${SETUP_TOKEN}`;
}

export function composeArguments(
  name: StackName,
  command: ComposeCommand,
): string[] {
  const prefix = ["compose", "--project-name", stackConfiguration(name).project];
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

export function stackVolumeName(name: StackName, volume: "asset-data"): string {
  return `${stackConfiguration(name).project}_${volume}`;
}

function runCompose(name: StackName, arguments_: string[]): void {
  const child = Bun.spawnSync(["docker", "compose", "--project-name", stackConfiguration(name).project, ...arguments_], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, ...stackEnvironment(name) },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) process.exit(child.exitCode);
}

function runDocker(name: StackName, command: ComposeCommand): void {
  runCompose(name, composeArguments(name, command).slice(3));
}

function removeDataVolume(name: StackName): void {
  const volume = stackVolumeName(name, "asset-data");
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

function resetData(name: StackName, restart: boolean): void {
  runDocker(name, "down");
  runCompose(name, ["up", "--detach", "--wait", "postgres"]);
  runCompose(name, [
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
  removeDataVolume(name);
  if (restart) {
    runDocker(name, "up");
    printReady(name);
  } else {
    runDocker(name, "down");
    console.log("\nKnowledge and assets were removed; owner, passkeys, and OAuth state were preserved.");
  }
}

function printReady(name: StackName): void {
  console.log(`\nContext Use ${name === "eval" ? "evaluation" : "development"} stack is ready.`);
  console.log(`App:   ${stackUrl(name)}`);
  console.log(`Setup: ${setupUrl(name)}`);
  if (name === "eval") console.log(`MCP:   ${stackUrl(name)}/mcp`);
}

export function runStackCommand(name: StackName, command: StackCommand): void {
  if (command === "url") {
    console.log(stackUrl(name));
    return;
  }
  if (command === "reset") {
    resetData(name, true);
    return;
  }
  if (command === "destroy") {
    resetData(name, false);
    return;
  }
  runDocker(name, command);
  if (command === "up") printReady(name);
}

if (import.meta.main) {
  const [rawName, rawCommand] = process.argv.slice(2);
  if (!(rawName === "local" || rawName === "eval")) usage();
  if (!rawCommand
    || !(["up", "down", "destroy", "purge", "reset", "logs", "status", "url"] as string[]).includes(rawCommand)) {
    usage();
  }
  runStackCommand(rawName, rawCommand as StackCommand);
}
