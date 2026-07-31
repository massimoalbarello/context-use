import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template plan", {
  description: "Preview safe default-template changes and local conflicts.",
  options: {},
  handler: async () => {
    const output = (await runKnowledgeTemplateCommand("plan")).trim();
    p.note(output || "No template changes", "Default template plan");
  },
});
