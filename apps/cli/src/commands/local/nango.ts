import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { localNangoOrigin, readLocalConfig, readLocalRuntimeEnvironment } from "../../local.ts";

export const command = defineCommand("local nango", {
  description: "Show the local Nango dashboard address and its sign-in credentials.",
  options: {},
  handler: async () => {
    const config = await readLocalConfig();
    const runtime = await readLocalRuntimeEnvironment();
    const password = runtime.NANGO_DASHBOARD_PASSWORD;
    if (!password) throw new Error("The local runtime environment has no Nango dashboard password");
    // The cloud deployment never reveals this credential because its Nango is
    // internet-facing and reached through an authenticating gateway. The local
    // dashboard is bound to loopback on the owner's own computer and there is
    // no such gateway, so the owner needs the credential to sign in.
    p.note(
      `URL:      ${localNangoOrigin(config)}\n`
      + `Username: ${runtime.NANGO_DASHBOARD_USERNAME ?? config.ownerEmail}\n`
      + `Password: ${password}`,
      "Local Nango dashboard",
    );
    p.log.info("Provider OAuth callbacks use this origin. Register it with the provider as the callback URL, for example "
      + `${localNangoOrigin(config)}/oauth/callback.`);
    p.log.warn("Provider webhooks cannot reach this computer, so local syncs run on their schedule only.");
  },
});
