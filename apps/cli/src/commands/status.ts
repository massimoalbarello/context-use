import { defineCommand } from "@parshjs/core";
import { readConfig } from "../paths.ts";

export const command = defineCommand("status", {
  description: "Show deployment status.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    console.log(JSON.stringify({
      phase: config.phase,
      version: config.releaseVersion,
      url: `https://${config.hostname}/app`,
      instance: config.computeOutputs?.instance_id,
      publicIp: config.computeOutputs?.public_ip,
    }, null, 2));
  },
});
