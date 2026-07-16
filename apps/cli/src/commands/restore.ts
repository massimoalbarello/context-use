import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { listBackups, sendSsmCommands } from "../aws.ts";
import { readConfig } from "../paths.ts";

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
    const commands = [
      "set -euo pipefail",
      "cd /opt/context-use/deploy",
      "docker compose --env-file /data/context-use/secrets/runtime.env run --rm backup once",
      "docker compose --env-file /data/context-use/secrets/runtime.env stop app backup",
      `aws s3 cp 's3://${config.dataOutputs.backup_bucket}/${selected}' - --only-show-errors | gunzip | docker compose --env-file /data/context-use/secrets/runtime.env exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d context_use`,
      "docker compose --env-file /data/context-use/secrets/runtime.env up -d app backup",
    ];
    await sendSsmCommands(config.awsProfile, config.awsRegion, config.computeOutputs.instance_id, commands);
    p.outro(`Database restored from ${selected}`);
  },
});
