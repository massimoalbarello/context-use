import { sendSsmCommands } from "./aws.ts";
import { run } from "./process.ts";
import type { DeploymentConfig } from "./types.ts";

/**
 * A place a Context Use deployment runs. Both targets execute the same Compose
 * shell against the same deployment directory layout; only the transport and
 * the two absolute paths differ. Cloud sends the script to EC2 over Systems
 * Manager, local runs it in a shell on this computer.
 */
export type DeploymentTarget = {
  kind: "cloud" | "local";
  /** Origin serving the dashboard, MCP, and health endpoints. */
  origin: string;
  deployDirectory: string;
  runtimeEnvPath: string;
  run(commands: string[], options?: { signal?: AbortSignal }): Promise<string>;
};

/**
 * Single-quote a path for the generated shell. Deployment directories are
 * derived from the release cache, so a home directory containing a quote would
 * otherwise end the quoting early.
 */
export function shellPath(path: string): string {
  if (path.includes("'") || path.includes("\n")) throw new Error(`Unsupported deployment path: ${path}`);
  return `'${path}'`;
}

export function deploymentPreamble(target: DeploymentTarget): string[] {
  return ["set -euo pipefail", `cd ${shellPath(target.deployDirectory)}`];
}

export function composeInvocation(target: DeploymentTarget): string {
  return `docker compose --env-file ${shellPath(target.runtimeEnvPath)}`;
}

export function cloudTarget(config: DeploymentConfig, instanceId: string): DeploymentTarget {
  return {
    kind: "cloud",
    origin: `https://${config.hostname}`,
    deployDirectory: "/opt/context-use/deploy",
    runtimeEnvPath: "/data/context-use/secrets/runtime.env",
    run: (commands, options) => sendSsmCommands(config.awsProfile, config.awsRegion, instanceId, commands, options),
  };
}

export function localTarget(options: {
  origin: string;
  deployDirectory: string;
  runtimeEnvPath: string;
}): DeploymentTarget {
  return {
    kind: "local",
    origin: options.origin,
    deployDirectory: options.deployDirectory,
    runtimeEnvPath: options.runtimeEnvPath,
    run: (commands, runOptions) => run(["bash"], {
      stdin: `${(commands[0] === "set -euo pipefail" ? commands : ["set -euo pipefail", ...commands]).join("\n")}\n`,
      quiet: true,
      ...(runOptions?.signal ? { signal: runOptions.signal } : {}),
    }),
  };
}
