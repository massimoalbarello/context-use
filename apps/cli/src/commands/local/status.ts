import { defineCommand } from "@parshjs/core";
import { instanceHealthy } from "../../instance.ts";
import {
  localAppOrigin,
  localComposeCommands,
  localNangoOrigin,
  readLocalConfigIfPresent,
  readLocalTarget,
} from "../../local.ts";

export const command = defineCommand("local status", {
  description: "Show local installation status.",
  options: {},
  handler: async () => {
    if (!(await readLocalConfigIfPresent())) {
      console.log(JSON.stringify({ state: "absent" }, null, 2));
      return;
    }
    const { config, target } = await readLocalTarget();
    const running = await target.run(localComposeCommands(target, "ps", "--status", "running", "--format", "'{{.Service}}'"))
      .then((output) => output.split("\n").filter(Boolean).length)
      .catch(() => 0);
    const healthy = running > 0 && await instanceHealthy(localAppOrigin(config), config.releaseVersion);
    console.log(JSON.stringify({
      state: running === 0 ? "stopped" : healthy ? "healthy" : "unhealthy",
      version: config.releaseVersion,
      url: `${localAppOrigin(config)}/app`,
      mcpUrl: `${localAppOrigin(config)}/mcp`,
      nangoUrl: localNangoOrigin(config),
      runningServices: running,
    }, null, 2));
  },
});
