import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { listBackups, sendSsmCommands } from "../aws.ts";
import { readConfig } from "../paths.ts";

export function restoreCommands(bucket: string, key: string): string[] {
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "set -a; . /data/context-use/secrets/runtime.env; set +a",
    "export PGPASSWORD=\"$POSTGRES_PASSWORD\"",
    `trap '${compose} up -d app backup >/dev/null 2>&1 || true' EXIT`,
    `${compose} run --rm backup once`,
    `${compose} stop app backup`,
    `aws s3 cp 's3://${bucket}/${key}' - --only-show-errors | gunzip | ${compose} exec -T -e PGPASSWORD postgres psql -v ON_ERROR_STOP=1 -U postgres -d context_use`,
    `${compose} up -d app backup`,
    "trap - EXIT",
  ];
}

export const command = defineCommand("restore", {
  description: "Restore PostgreSQL from an encrypted backup.",
  options: {},
  handler: async () => {
    const config = await readConfig();
    if (!config.computeOutputs || !config.dataOutputs) throw new Error("No active deployment");
    const backups = await listBackups(config.awsProfile, config.awsRegion, config.dataOutputs.backup_bucket);
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
    const typed = await p.text({ message: `Type ${config.hostname} to replace the live database` });
    if (p.isCancel(typed) || typed !== config.hostname) throw new Error("Confirmation did not match");
    const commands = restoreCommands(config.dataOutputs.backup_bucket, selected);
    await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, commands);
    p.outro(`Database restored from ${selected}`);
  },
});
