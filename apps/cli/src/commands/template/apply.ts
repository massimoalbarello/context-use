import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template apply", {
  description: "Create missing template guides and update eligible existing ones.",
  options: {
    "overwrite-guides": {
      schema: z.boolean().optional(),
      description: "Replace locally modified active AGENTS.md guides with the template.",
    },
  },
  handler: async ({ options }) => {
    const output = (await runKnowledgeTemplateCommand("apply", {
      overwriteGuides: options["overwrite-guides"] ?? false,
    })).trim();
    p.note(output || "No template changes", "Default template applied");
  },
});
