import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template apply", {
  description: "Create missing default-template guides and update untouched ones.",
  options: {},
  handler: async () => {
    const output = (await runKnowledgeTemplateCommand("apply")).trim();
    p.note(output || "No template changes", "Default template applied");
  },
});
