import { defineCommand } from "@parshjs/core";
import { setup } from "../setup.ts";

export const command = defineCommand("setup", {
  description: "Create a new AWS deployment.",
  options: {},
  handler: setup,
});
