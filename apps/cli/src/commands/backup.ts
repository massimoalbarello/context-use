import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { sendSsmCommands } from "../aws.ts";
import { readInfrastructure } from "../lifecycle.ts";

export function releaseIncludesNango(version: string): boolean {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[a-z0-9.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid installed release version: ${version}`);
  const major = Number(match[1]!);
  const minor = Number(match[2]!);
  const patch = Number(match[3]!);
  return major > 0 || minor > 1 || (minor === 1 && patch >= 47);
}

export function databaseBackupCommands(requireNango: boolean): string[] {
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const database = `${compose} exec -T -e PGPASSWORD postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d context_use`;
  const nangoBackup = `${compose} run --rm nango-backup once`;
  const initializedNango = `${compose} run --rm --no-deps --entrypoint psql nango-backup -X -tAc 'SELECT 1' | grep -qx 1`;
  const backupWhenDefined = requireNango
    ? nangoBackup
    : `if ${initializedNango}; then ${nangoBackup}; else echo "Older or partially upgraded deployment has no initialized Nango database; skipping it"; fi`;
  const unavailable = requireNango
    ? 'echo "This deployment does not define the nango-backup service" >&2; exit 1'
    : 'echo "Older deployment has no nango-backup service; skipping it"';
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "export PGPASSWORD=\"$(sed -n 's/^POSTGRES_PASSWORD=//p' /data/context-use/secrets/runtime.env)\"",
    `${database} -c 'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO context_use_backup'`,
    `${compose} run --rm backup once`,
    `if ${compose} config --services | grep -Fx nango-backup >/dev/null; then ${backupWhenDefined}; else ${unavailable}; fi`,
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
