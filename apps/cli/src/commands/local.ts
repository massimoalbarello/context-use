import { defineCommand } from "@parshjs/core";

export const command = defineCommand("local", {
  description: "Manage the installation running on this computer.",
  options: {},
});
