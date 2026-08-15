import * as p from "@clack/prompts";
import {
  buildLocalRuntimeEnvironment,
  type LocalConfig,
  localCompose,
  localComposeCommands,
  updateLocalRuntimeValue,
  writeLocalRuntimeEnvironment,
} from "./local.ts";
import { nangoApiKeyWriteCommands } from "./nango.ts";
import type { DeploymentTarget } from "./target.ts";
import type { ReleaseManifest } from "./types.ts";

/**
 * Bring the local stack to a running state.
 *
 * The ordering mirrors `deploy/deploy.sh`: PostgreSQL first, then the Context
 * Use migrations, then Nango's own database roles, and only then every service.
 * Both profile-gated one-shot services stay out of the steady-state `up`.
 */
export async function startLocalStack(
  target: DeploymentTarget,
  options: { installTemplate?: string } = {},
): Promise<void> {
  if (options.installTemplate && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.installTemplate)) {
    throw new Error(`Invalid template name: ${options.installTemplate}`);
  }
  const migrate = options.installTemplate
    ? ["--profile", "migration", "run", "--rm", "-e", `CONTEXT_USE_TEMPLATE_INSTALL=${options.installTemplate}`, "migrate"]
    : ["--profile", "migration", "run", "--rm", "migrate"];
  await target.run(localComposeCommands(target, "up", "-d", "--wait", "postgres"));
  await target.run(localComposeCommands(target, ...migrate));
  await target.run(localComposeCommands(target, "--profile", "nango-init", "run", "--rm", "nango-db-init"));
  await target.run(localComposeCommands(target, "up", "-d", "--wait", "--remove-orphans"));
}

/**
 * Nango issues the scoped pipeline key only once it is running, so this is a
 * second pass after the stack is up. The private MCP service is the only reader
 * and picks the value up when it is recreated.
 */
export async function reconcileLocalNangoPipelineKey(target: DeploymentTarget): Promise<void> {
  const secret = (await target.run(nangoApiKeyWriteCommands({
    deployDirectory: target.deployDirectory,
    compose: localCompose(target),
    displayName: "context-use-pipeline",
  }))).trim();
  if (!secret || /\s/.test(secret)) throw new Error("Nango did not return a usable pipeline API key");
  await updateLocalRuntimeValue("NANGO_PIPELINE_API_KEY", secret);
  await target.run(localComposeCommands(target, "up", "-d", "--wait", "--force-recreate", "--no-deps", "private-mcp"));
}

export async function installLocalRuntimeEnvironment(
  config: LocalConfig,
  manifest: ReleaseManifest,
): Promise<string> {
  const { values, ownerSetupToken } = await buildLocalRuntimeEnvironment(config, manifest);
  await writeLocalRuntimeEnvironment(values);
  return ownerSetupToken;
}

export async function reportLocalStackStart(
  target: DeploymentTarget,
  options: { installTemplate?: string } = {},
): Promise<void> {
  const progress = p.spinner();
  progress.start("Starting the local stack");
  try {
    await startLocalStack(target, options);
    progress.message("Reconciling the Nango pipeline key");
    await reconcileLocalNangoPipelineKey(target);
    progress.stop("Local stack is running");
  } catch (error) {
    progress.stop("Local stack failed to start");
    throw error;
  }
}
