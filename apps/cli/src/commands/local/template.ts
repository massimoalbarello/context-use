import { defineCommand } from "@parshjs/core";

export const command = defineCommand("local template", {
  description: "Inspect or apply default knowledge directories, guides, and managed pages.",
  options: {},
});
