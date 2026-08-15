import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../../aws.ts";
import { databaseBackupCommands } from "../../backup.ts";
import { readInfrastructure } from "../../lifecycle.ts";

export const command = defineCommand("cloud backup", {
  description: "Create verified Context Use and Nango database backups now.",
  options: {},
  handler: async () => {
    const { config, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use cloud recover`");
    if (!compute) throw new Error("No active instance");
    await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, databaseBackupCommands(true));
    p.outro("Context Use and Nango backups completed");
  },
});
