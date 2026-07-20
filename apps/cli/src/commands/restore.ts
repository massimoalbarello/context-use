import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { listBackups, sendSsmCommands } from "../aws.ts";
import { verifyDeployment } from "../deploy.ts";
import { readInfrastructure } from "../lifecycle.ts";
import type { DataOutputs, DeploymentConfig } from "../types.ts";

export function restoreCommands(bucket: string, key: string): string[] {
  if (!/^postgres\/[0-9TZ-]+\.sql\.gz$/.test(key)) throw new Error("Invalid backup key");
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const clients = "caddy dashboard-edge auth-edge private-mcp-edge app auth private-mcp public-web confirmation storage public-mcp backup";
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "set -a; . /data/context-use/secrets/runtime.env; set +a",
    "export PGPASSWORD=\"$POSTGRES_PASSWORD\"",
    `restore_failed() { ${compose} up -d postgres aws-credential-broker backup >/dev/null 2>&1 || true; }`,
    "trap restore_failed EXIT",
    `${compose} run --rm backup once`,
    `${compose} stop ${clients}`,
    `${compose} up -d postgres aws-credential-broker`,
    `${compose} run --rm -T -e BACKUP_BUCKET='${bucket}' backup fetch '${key}' | gunzip | ${compose} exec -T -e PGPASSWORD postgres psql --single-transaction -v ON_ERROR_STOP=1 -U postgres -d context_use`,
    `${compose} --profile migration run --rm migrate`,
    `${compose} up -d --remove-orphans`,
    "trap - EXIT",
  ];
}

export async function selectBackup(config: DeploymentConfig, data: DataOutputs): Promise<string> {
  const backups = await listBackups(config.awsProfile, config.awsRegion, data.backup_bucket);
  if (backups.length === 0) throw new Error("No PostgreSQL backups are available");
  const selected = await p.select({
    message: "Backup to restore",
    options: backups.slice(0, 100).map((backup) => ({
      value: backup.key,
      label: `${backup.modified} · ${(backup.size / 1_048_576).toFixed(1)} MiB`,
    })),
  });
  if (p.isCancel(selected)) throw new Error("Restore cancelled");
  if (!/^postgres\/[0-9TZ-]+\.sql\.gz$/.test(selected)) throw new Error("Invalid backup key");
  return selected;
}

export const command = defineCommand("restore", {
  description: "Restore PostgreSQL from an encrypted backup.",
  options: {},
  handler: async () => {
    const { config, manifest, data, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    if (!compute || !data) throw new Error("No active deployment");
    const selected = await selectBackup(config, data);
    const typed = await p.text({ message: `Type ${config.hostname} to replace the live database` });
    if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
    await sendSsmCommands(config.awsProfile, config.awsRegion, compute.instance_id, restoreCommands(data.backup_bucket, selected));
    await verifyDeployment(config, manifest.version);
    p.outro(`Database restored from ${selected}`);
  },
});
