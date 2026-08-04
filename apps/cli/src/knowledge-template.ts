import { sendSsmCommands } from "./aws.ts";
import { readInfrastructure } from "./lifecycle.ts";

export type KnowledgeTemplateAction = "plan" | "apply";

export function knowledgeTemplateCommands(
  action: KnowledgeTemplateAction,
  templateName = "default",
  overwriteGuides = false,
  overwriteManagedPages = false,
): string[] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateName)) throw new Error(`Invalid template name: ${templateName}`);
  const compose = "docker compose --env-file /data/context-use/secrets/runtime.env";
  return [
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    `${compose} --profile migration run --rm migrate bun packages/database/src/template-command.ts ${action} ${templateName}${overwriteGuides ? " --overwrite-guides" : ""}${overwriteManagedPages ? " --overwrite-managed-pages" : ""}`,
  ];
}

export async function runKnowledgeTemplateCommand(
  action: KnowledgeTemplateAction,
  options: { overwriteGuides?: boolean; overwriteManagedPages?: boolean } = {},
): Promise<string> {
  const { config, compute } = await readInfrastructure();
  if (config.recovery) throw new Error("Volume recovery is in progress; run `context-use recover`");
  if (!compute) throw new Error("No active instance");
  return sendSsmCommands(
    config.awsProfile,
    config.awsRegion,
    compute.instance_id,
    knowledgeTemplateCommands(action, "default", options.overwriteGuides, options.overwriteManagedPages),
  );
}
