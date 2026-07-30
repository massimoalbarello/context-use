import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../aws.ts";
import { readInfrastructure } from "../lifecycle.ts";

export function databaseBackupCommands(requireNango: boolean): string[] {
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const unavailable = requireNango
    ? 'echo "This deployment does not define the nango-backup service" >&2; exit 1'
    : 'echo "Older deployment has no nango-backup service; skipping it"';
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    `${compose} run --rm backup once`,
    `if ${compose} config --services | grep -Fx nango-backup >/dev/null; then ${compose} run --rm nango-backup once; else ${unavailable}; fi`,
  ];
}

export const command = defineCommand("backup", {
  description: "Create verified Context Use and Nango database backups now.",
  options: {},
  handler: async () => {
    const { config, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    if (!compute) throw new Error("No active instance");
    await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, databaseBackupCommands(true));
    p.outro("Context Use and Nango backups completed");
  },
});
