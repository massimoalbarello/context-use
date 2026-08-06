import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { listBackups, sendSsmCommands } from "../../aws.ts";
import { refreshNangoPipelineRuntime, verifyDeployment } from "../../deploy.ts";
import { readInfrastructure } from "../../lifecycle.ts";
import { ensureNangoApiKeys } from "../../nango.ts";
import type { DataOutputs, DeploymentConfig } from "../../types.ts";

const nangoBackupKeyPattern = /^nango-postgres\/[0-9TZ-]+\.sql\.gz$/;

export function nangoRestoreCommands(bucket: string, key: string): string[] {
  if (!/^[a-z0-9.-]{3,63}$/.test(bucket)) throw new Error("Invalid backup bucket");
  if (!nangoBackupKeyPattern.test(key)) throw new Error("Invalid Nango backup key");
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  const nangoServices = "nango-jobs nango-server nango-orchestrator nango-persist nango-redis nango-backup";
  const nangoServerCore = "nango-redis nango-server";
  const nangoWorkers = "nango-orchestrator nango-persist nango-jobs";
  const adminDatabase = `${compose} exec -T -e PGPASSWORD postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres`;
  const nangoDatabase = `${compose} exec -T -e PGPASSWORD postgres psql -X -v ON_ERROR_STOP=1 -U nango_app -d nango`;
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "export POSTGRES_PASSWORD=\"$(sed -n 's/^POSTGRES_PASSWORD=//p' /data/context-use/secrets/runtime.env)\"",
    "export NANGO_DB_PASSWORD=\"$(sed -n 's/^NANGO_DB_PASSWORD=//p' /data/context-use/secrets/runtime.env)\"",
    `${compose} config --services | grep -Fx nango-backup >/dev/null`,
    `running_services="$(${compose} ps --status running --services)"`,
    `if printf '%s\\n' "$running_services" | grep -Fx nango-server >/dev/null; then ${compose} run --rm nango-backup once; else echo "Nango is already stopped; reusing the previously verified backup without taking another" >&2; fi`,
    `restore_failed() { echo "Nango restore failed; Nango services remain stopped" >&2; ${compose} stop ${nangoServices} >/dev/null 2>&1 || true; }`,
    "trap restore_failed EXIT",
    `${compose} stop ${nangoServices}`,
    `${compose} rm -f nango-redis`,
    'quarantine="/data/context-use/nango-integrations-quarantine/$(date -u +%Y%m%dT%H%M%SZ)"',
    'mkdir -p "$quarantine"; chmod 0700 "$quarantine"',
    'find /data/context-use/nango-integrations -mindepth 1 -maxdepth 1 -exec mv -t "$quarantine" -- {} +',
    `${compose} up -d postgres aws-credential-broker`,
    "export PGPASSWORD=\"$POSTGRES_PASSWORD\"",
    `${adminDatabase} -c 'DROP DATABASE IF EXISTS nango WITH (FORCE)'`,
    `${compose} --profile nango-init run --rm nango-db-init`,
    "export PGPASSWORD=\"$NANGO_DB_PASSWORD\"",
    `${compose} run --rm --no-deps -T -e BACKUP_BUCKET='${bucket}' nango-backup fetch '${key}' | gunzip | ${nangoDatabase} --single-transaction`,
    `${compose} --profile nango-init run --rm nango-db-init`,
    `${compose} up -d --wait ${nangoServerCore}`,
    `${compose} up -d --wait ${nangoWorkers}`,
    `${compose} --profile nango-init run --rm nango-db-init`,
    `${compose} up -d nango-backup`,
    "trap - EXIT",
  ];
}

export async function selectNangoBackup(config: DeploymentConfig, data: DataOutputs): Promise<string> {
  const backups = await listBackups(config.awsProfile, config.awsRegion, data.backup_bucket, "nango-postgres");
  if (backups.length === 0) throw new Error("No Nango PostgreSQL backups are available");
  const selected = await p.select({
    message: "Nango backup to restore",
    options: backups.slice(0, 100).map((backup) => ({
      value: backup.key,
      label: `${backup.modified} · ${(backup.size / 1_048_576).toFixed(1)} MiB`,
    })),
  });
  if (p.isCancel(selected)) throw new Error("Restore cancelled");
  if (!nangoBackupKeyPattern.test(selected)) throw new Error("Invalid Nango backup key");
  return selected;
}

export async function selectOptionalNangoBackup(
  config: DeploymentConfig,
  data: DataOutputs,
): Promise<string | undefined> {
  const backups = await listBackups(config.awsProfile, config.awsRegion, data.backup_bucket, "nango-postgres");
  if (backups.length === 0) {
    p.log.warn("No Nango backup is available; recovery will continue without Nango raw data");
    return undefined;
  }
  const selected = await p.select({
    message: "Nango backup to restore",
    options: [
      ...backups.slice(0, 99).map((backup, index) => ({
        value: backup.key,
        label: `${index === 0 ? "Latest · " : ""}${backup.modified} · ${(backup.size / 1_048_576).toFixed(1)} MiB`,
      })),
      { value: "skip", label: "Do not restore Nango raw data" },
    ],
  });
  if (p.isCancel(selected)) throw new Error("Recovery cancelled");
  if (selected === "skip") return undefined;
  if (!nangoBackupKeyPattern.test(selected)) throw new Error("Invalid Nango backup key");
  return selected;
}

export const command = defineCommand("nango restore", {
  description: "Restore Nango's PostgreSQL database from an encrypted backup.",
  options: {},
  handler: async () => {
    const { config, manifest, data, compute } = await readInfrastructure();
    if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
    if (!compute || !data) throw new Error("No active deployment");
    const selected = await selectNangoBackup(config, data);
    const typed = await p.text({ message: `Type ${config.nangoHostname} to replace the live Nango database` });
    if (p.isCancel(typed) || typed !== config.nangoHostname) throw new Error("Confirmation did not match");
    await sendSsmCommands(
      config.awsProfile,
      config.awsRegion,
      compute.instance_id,
      nangoRestoreCommands(data.backup_bucket, selected),
    );
    await verifyDeployment(config, manifest.version, compute.instance_id);
    await ensureNangoApiKeys(config, data, compute.instance_id);
    await refreshNangoPipelineRuntime(config, compute);
    p.outro(`Nango database restored from ${selected}. Run \`context-use nango integrations deploy\` before relying on scheduled syncs; pre-restore artifacts were quarantined on the retained volume.`);
  },
});
