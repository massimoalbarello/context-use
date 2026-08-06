import { defineCommand } from "@parshjs/core";
import { readConfig } from "../../paths.ts";

export function formatNangoAccess(url: string): string {
  return [
    `URL: ${url}`,
    "Authentication: Context Use passkey",
    "Nango's internal credentials are not disclosed.",
  ].join("\n");
}

export const command = defineCommand("nango credentials", {
  description: "Show how to access the passkey-protected Nango dashboard.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    console.log(formatNangoAccess(`https://${config.nangoHostname}`));
  },
});
