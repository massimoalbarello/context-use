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
    let nangoHealthy = false;
    if (compute) {
      const [appResult, nangoResult] = await Promise.allSettled([
        fetch(`https://${config.hostname}/api/health`, { signal: AbortSignal.timeout(5_000) }),
        fetch(`https://${config.nangoHostname}/ready`, { signal: AbortSignal.timeout(5_000) }),
      ]);
      if (appResult.status === "fulfilled") {
        try {
          healthy = appResult.value.ok && healthMatchesVersion(await appResult.value.json(), config.releaseVersion);
        } catch {}
      }
      nangoHealthy = nangoResult.status === "fulfilled" && nangoResult.value.ok;
    }
    const state = config.recovery
      ? "recovering"
      : !data
        ? "absent"
        : !dataVolumePresent
          ? "volume-lost"
          : !compute
            ? "data-retained"
            : healthy && nangoHealthy
              ? "healthy"
              : "unhealthy";
    console.log(JSON.stringify({
      state,
      version: config.releaseVersion,
      url: `https://${config.hostname}/app`,
      nangoUrl: `https://${config.nangoHostname}`,
      nangoHealthy,
      instance: compute?.instance_id,
      publicIp: compute?.public_ip,
      dataVolume: data?.data_volume_id,
    }, null, 2));
  },
});
