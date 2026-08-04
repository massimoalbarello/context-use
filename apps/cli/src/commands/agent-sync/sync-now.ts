import { defineCommand } from "@parshjs/core";

import { runAgentSync } from "../../agent-sync/runtime.ts";

export const command = defineCommand("agent-sync sync-now", {
  description: "Run agent conversation discovery and upload immediately.",
  options: {},
  handler: async () => {
    console.log(JSON.stringify(await runAgentSync(), null, 2));
  },
});
