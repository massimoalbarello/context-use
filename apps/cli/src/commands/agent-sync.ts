import { defineCommand } from "@parshjs/core";

export const command = defineCommand("agent-sync", {
  description: "Copy local agent conversations into Context Use through Nango.",
  options: {},
});
