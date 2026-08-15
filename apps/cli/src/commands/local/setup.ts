import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { installLocalRuntimeEnvironment, reportLocalStackStart } from "../../local-lifecycle.ts";
import {
  DEFAULT_APP_PORT,
  DEFAULT_NANGO_PORT,
  type LocalConfig,
  localAppOrigin,
  localConfigPath,
  localDeployDirectory,
  localNangoOrigin,
  localRuntimeEnvPath,
  localSetupUrl,
  normalizeLocalConfig,
  readLocalConfigIfPresent,
  saveLocalConfig,
} from "../../local.ts";
import { isValidOwnerEmail } from "../../paths.ts";
import { commandExists } from "../../process.ts";
import { releaseManifest } from "../../release.ts";
import { localTarget } from "../../target.ts";

function required(result: string | symbol | undefined, label: string): string {
  if (p.isCancel(result)) { p.cancel("Setup cancelled"); process.exit(0); }
  if (!result) throw new Error(`${label} is required`);
  return result;
}

export const command = defineCommand("local setup", {
  description: "Install Context Use on this computer.",
  options: {
    "app-port": {
      schema: z.coerce.number().optional(),
      description: `Loopback port for the dashboard, MCP, and published pages (default ${DEFAULT_APP_PORT}).`,
    },
    "nango-port": {
      schema: z.coerce.number().optional(),
      description: `Loopback port for the Nango dashboard and OAuth callbacks (default ${DEFAULT_NANGO_PORT}).`,
    },
  },
  handler: async ({ options }) => {
    p.intro("context-use · local installation");
    if (await readLocalConfigIfPresent()) {
      throw new Error(`A local installation already exists at ${localConfigPath}. Use \`context-use local status\` or \`context-use local destroy\`.`);
    }
    if (!(await commandExists("docker"))) throw new Error("Docker is required. Install it and try again.");
    if (!(await commandExists("gh"))) throw new Error("GitHub CLI is required to verify the release artifacts. Install it and try again.");

    const ownerEmail = required(
      await p.text({ message: "Owner email", validate: (input) => isValidOwnerEmail(input) ? undefined : "Enter a valid email" }),
      "Owner email",
    ).trim().toLowerCase();
    const manifest = await releaseManifest(process.env.CONTEXT_USE_VERSION ?? "latest");
    const config: LocalConfig = normalizeLocalConfig({
      schemaVersion: 1,
      releaseVersion: manifest.version,
      ownerEmail,
      appPort: options["app-port"] ?? DEFAULT_APP_PORT,
      nangoPort: options["nango-port"] ?? DEFAULT_NANGO_PORT,
    });

    const target = localTarget({
      origin: localAppOrigin(config),
      deployDirectory: await localDeployDirectory(manifest),
      runtimeEnvPath: localRuntimeEnvPath,
    });
    const ownerSetupToken = await installLocalRuntimeEnvironment(config, manifest);
    await reportLocalStackStart(target, { installTemplate: "default" });
    await saveLocalConfig(config);

    p.outro(
      `context-use is running on this computer. Create the owner passkey:\n${localSetupUrl(config, ownerSetupToken)}\n\n`
      + `Connect an agent over MCP at ${localAppOrigin(config)}/mcp\n`
      + `Nango is at ${localNangoOrigin(config)}; run \`context-use local nango\` for its credentials.\n\n`
      + "Published pages are served on loopback only and are not reachable from the internet.",
    );
  },
});
