import { defineCommand } from "@parshjs/core";
import { updateDeployment } from "../../update.ts";

export const command = defineCommand("cloud update", {
  description: "Update the CLI and deployment to the latest release.",
  options: {},
  handler: updateDeployment,
});
