import { defineCommand } from "@parshjs/core";
import { retainedDataVolumeExists } from "../data-volume.ts";
import { healthMatchesVersion } from "../deploy.ts";
import { readInfrastructure } from "../lifecycle.ts";

export const command = defineCommand("status", {
  description: "Show deployment status.",
  options: {},
  handler: async () => {
    const { config, data, compute } = await readInfrastructure(false);
    const dataVolumePresent = data ? await retainedDataVolumeExists(config, data) : false;
    let healthy = false;
    if (compute) {
      try {
        const response = await fetch(`https://${config.hostname}/api/health`, { signal: AbortSignal.timeout(5_000) });
        healthy = response.ok && healthMatchesVersion(await response.json(), config.releaseVersion);
      } catch {}
    }
    const state = config.recovery
      ? "recovering"
      : !data
        ? "absent"
        : !dataVolumePresent
          ? "volume-lost"
          : !compute
            ? "data-retained"
            : healthy
              ? "healthy"
              : "unhealthy";
    console.log(JSON.stringify({
      state,
      version: config.releaseVersion,
      url: `https://${config.hostname}/app`,
      instance: compute?.instance_id,
      publicIp: compute?.public_ip,
      dataVolume: data?.data_volume_id,
    }, null, 2));
  },
});
