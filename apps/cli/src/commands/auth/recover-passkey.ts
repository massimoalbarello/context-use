import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../../aws.ts";
import { readConfig } from "../../paths.ts";

export const command = defineCommand("auth recover-passkey", {
  description: "Start owner-controlled passkey recovery through AWS.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    if (!config.computeOutputs) throw new Error("No active instance");
    const output = await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, [
      "cd /opt/context-use/deploy && docker compose --env-file /data/context-use/secrets/runtime.env exec -T app bun apps/server/src/recover-passkey.ts",
    ]);
    console.log(output.trim());
  },
});
