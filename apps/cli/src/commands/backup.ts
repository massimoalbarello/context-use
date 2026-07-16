import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../aws.ts";
import { readConfig } from "../paths.ts";

export const command = defineCommand("backup", {
  description: "Create a verified database backup now.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    if (!config.computeOutputs) throw new Error("No active instance");
    await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, [
      "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
    ]);
    p.outro("Backup completed");
  },
});
