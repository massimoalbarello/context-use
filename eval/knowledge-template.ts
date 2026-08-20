import { join } from "node:path";
import { runStackCommand } from "../scripts/local-stack.ts";
import { ROOT } from "./runner/agent.ts";

export const EVAL_KNOWLEDGE_TEMPLATES = ["default", "greedy"] as const;
export type EvalKnowledgeTemplate = typeof EVAL_KNOWLEDGE_TEMPLATES[number];

export function isEvalKnowledgeTemplate(value: string): value is EvalKnowledgeTemplate {
  return (EVAL_KNOWLEDGE_TEMPLATES as readonly string[]).includes(value);
}

export function knowledgeTemplateSourceDirectory(template: EvalKnowledgeTemplate): string {
  return template === "default"
    ? join(ROOT, "packages", "database", "templates", "default")
    : join(ROOT, "eval", "templates", template);
}

/**
 * The default template is the product template bundled with the database package. Ablation
 * templates live under eval/, which the production image does not copy, and are exposed to the
 * development reset only through this explicit root.
 */
export function knowledgeTemplateInstall(template: EvalKnowledgeTemplate): {
  name: string;
  root?: string;
} {
  return template === "default"
    ? { name: "default" }
    : { name: template, root: "/app/eval/templates" };
}

export function resetForEval(template: EvalKnowledgeTemplate): void {
  runStackCommand("reset", { knowledgeTemplate: knowledgeTemplateInstall(template) });
}
