import { defineCommand } from "@parshjs/core";

export const command = defineCommand("cloud", {
  description: "Manage the deployment in your AWS account.",
  options: {},
});
