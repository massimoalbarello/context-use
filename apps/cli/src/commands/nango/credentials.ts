import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { getSecureParameter } from "../../aws.ts";
import { readConfig } from "../../paths.ts";

export function formatNangoCredentials(
  url: string,
  username: string,
  password: string | null,
): string {
  return [
    `URL: ${url}`,
    `Username: ${username}`,
    `Password: ${password ?? "******** (use --reveal to show)"}`,
  ].join("\n");
}

export const command = defineCommand("nango credentials", {
  description: "Show Nango dashboard login details.",
  options: {
    reveal: {
      schema: z.boolean().optional(),
      description: "Reveal the dashboard password.",
    },
  },
  handler: async ({ options }) => {
    const config = await readConfig();
    const prefix = `/context-use/${config.installationId}/${config.environment}`;
    const username = await getSecureParameter(
      config.awsProfile,
      config.awsRegion,
      `${prefix}/NANGO_DASHBOARD_USERNAME`,
    );
    const password = options.reveal
      ? await getSecureParameter(
        config.awsProfile,
        config.awsRegion,
        `${prefix}/NANGO_DASHBOARD_PASSWORD`,
      )
      : null;
    console.log(formatNangoCredentials(`https://${config.nangoHostname}`, username, password));
  },
});
