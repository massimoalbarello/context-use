import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import {
  deleteLocalConfig,
  localComposeCommands,
  readLocalTarget,
  removeLocalRuntimeEnvironment,
} from "../../local.ts";

export const command = defineCommand("local destroy", {
  description: "Stop the local installation, preserving its data by default.",
  options: {
    "purge-data": {
      schema: z.boolean().optional(),
      description: "Also permanently delete local knowledge, assets, and the owner passkey.",
    },
  },
  handler: async ({ options }) => {
    const purgeData = options["purge-data"];
    const { target } = await readLocalTarget();
    const typed = await p.text({
      message: purgeData
        ? "Type localhost to permanently destroy all local data"
        : "Type localhost to stop the local installation while preserving data",
    });
    if (p.isCancel(typed) || typed !== "localhost") throw new Error("Confirmation did not match");

    if (!purgeData) {
      await target.run(localComposeCommands(target, "down", "--remove-orphans"));
      p.outro("Local services stopped. Knowledge, assets, and the owner passkey are preserved.");
      return;
    }

    const confirmed = await p.confirm({
      message: "Final confirmation: permanently delete every local page, asset, and credential?",
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      throw new Error("Permanent purge cancelled; services are still running");
    }
    await target.run(localComposeCommands(target, "down", "--volumes", "--remove-orphans"));
    await removeLocalRuntimeEnvironment();
    await deleteLocalConfig();
    p.outro("The local installation and all of its data were removed.");
  },
});
