import { defineCommand } from "@parshjs/core";
import { currentVersion } from "../release.ts";

export const command = defineCommand("version", {
  description: "Print the context-use CLI version.",
  options: {},
  handler: () => {
    console.log(currentVersion);
  },
});
