import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../aws.ts";
import { readInfrastructure } from "../lifecycle.ts";

export const command = defineCommand("backup", {
  description: "Create a verified database backup now.",
  options: {},
  handler: async () => {
    const { config, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    if (!compute) throw new Error("No active instance");
    await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, [
      "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
    ]);
    p.outro("Backup completed");
  },
});
