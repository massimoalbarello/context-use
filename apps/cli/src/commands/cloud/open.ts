import { defineCommand } from "@parshjs/core";
import { openDashboard } from "../../instance.ts";
import { readConfig } from "../../paths.ts";

export const command = defineCommand("cloud open", {
  description: "Open the dashboard.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    openDashboard(`https://${config.hostname}`);
  },
});
