import { composeInvocation, deploymentPreamble, type DeploymentTarget } from "./target.ts";

export type KnowledgeTemplateAction = "plan" | "apply";

export function knowledgeTemplateCommands(
  target: DeploymentTarget,
  action: KnowledgeTemplateAction,
  templateName = "default",
  forceTemplate = false,
): string[] {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateName)) throw new Error(`Invalid template name: ${templateName}`);
  return [
    ...deploymentPreamble(target),
    `${composeInvocation(target)} --profile migration run --rm migrate bun packages/database/src/template-command.ts ${action} ${templateName}${forceTemplate ? " --force-template" : ""}`,
  ];
}

export async function runKnowledgeTemplateCommand(
  target: DeploymentTarget,
  action: KnowledgeTemplateAction,
  options: { forceTemplate?: boolean } = {},
): Promise<string> {
  return target.run(knowledgeTemplateCommands(target, action, "default", options.forceTemplate));
}
