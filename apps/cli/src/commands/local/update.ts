import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { continueUpdateWithCli, installCliRelease } from "../../cli-update.ts";
import { buildLocalRuntimeEnvironment, localDeployDirectory, localRuntimeEnvPath, readLocalConfigIfPresent, readLocalRuntimeEnvironment, localAppOrigin, saveLocalConfig, writeLocalRuntimeEnvironment } from "../../local.ts";
import { reportLocalStackStart } from "../../local-lifecycle.ts";
import { currentVersion, releaseManifest } from "../../release.ts";
import { localTarget } from "../../target.ts";

export const command = defineCommand("local update", {
  description: "Update the CLI and the local installation to the latest release.",
  options: {},
  handler: async () => {
    const manifest = await releaseManifest(process.env.CONTEXT_USE_UPDATE_CONTINUATION === "1" ? currentVersion : "latest");
    if (currentVersion !== manifest.version) {
      const executable = await installCliRelease(manifest);
      p.log.success(`Updated CLI to ${manifest.version}`);
      await continueUpdateWithCli(executable, manifest.version, ["local", "update"]);
      return;
    }

    const config = await readLocalConfigIfPresent();
    if (!config) {
      p.log.info("No local context-use installation; skipping");
      p.outro(`CLI is at ${manifest.version}`);
      return;
    }

    // Existing secrets, the owner setup token hash, and the reconciled Nango
    // pipeline key are all preserved. Only the pinned images and origins are
    // refreshed, so an update never invalidates the owner's passkey.
    const existing = await readLocalRuntimeEnvironment();
    const { values } = await buildLocalRuntimeEnvironment({ ...config, releaseVersion: manifest.version }, manifest);
    await writeLocalRuntimeEnvironment({
      ...values,
      ...existing,
      APP_IMAGE: values.APP_IMAGE!,
      BACKUP_IMAGE: values.BACKUP_IMAGE!,
      NANGO_IMAGE: values.NANGO_IMAGE!,
    });

    const target = localTarget({
      origin: localAppOrigin(config),
      deployDirectory: await localDeployDirectory(manifest),
      runtimeEnvPath: localRuntimeEnvPath,
    });
    await reportLocalStackStart(target);
    await saveLocalConfig({ ...config, releaseVersion: manifest.version });
    p.outro(`Local installation updated to ${manifest.version}`);
  },
});
