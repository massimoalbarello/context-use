import { defineCommand } from "@parshjs/core";
import { openDashboard } from "../../instance.ts";
import { localAppOrigin, readLocalConfig } from "../../local.ts";

export const command = defineCommand("local open", {
  description: "Open the dashboard.",
  options: {},
  handler: async () => {
    openDashboard(localAppOrigin(await readLocalConfig()));
  },
});
