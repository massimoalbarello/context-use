import { defineCommand } from "@parshjs/core";
import { readConfig } from "../paths.ts";

export const command = defineCommand("open", {
  description: "Open the dashboard.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", `https://${config.hostname}/app`]);
  },
});
