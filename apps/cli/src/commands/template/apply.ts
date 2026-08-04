import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template apply", {
  description: "Create missing template knowledge and update eligible guides and managed pages.",
  options: {
    "overwrite-guides": {
      schema: z.boolean().optional(),
      description: "Replace locally modified active AGENTS.md guides with the template.",
    },
    "overwrite-managed-pages": {
      schema: z.boolean().optional(),
      description: "Replace locally modified managed pages with the template.",
    },
  },
  handler: async ({ options }) => {
    const output = (await runKnowledgeTemplateCommand("apply", {
      overwriteGuides: options["overwrite-guides"] ?? false,
      overwriteManagedPages: options["overwrite-managed-pages"] ?? false,
    })).trim();
    p.note(output || "No template changes", "Default template applied");
  },
});
