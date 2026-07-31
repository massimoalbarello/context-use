import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template plan", {
  description: "Preview safe default-template changes and local conflicts.",
  options: {
    "overwrite-guides": {
      schema: z.boolean().optional(),
      description: "Preview replacement of locally modified active AGENTS.md guides.",
    },
  },
  handler: async ({ options }) => {
    const output = (await runKnowledgeTemplateCommand("plan", {
      overwriteGuides: options["overwrite-guides"] ?? false,
    })).trim();
    p.note(output || "No template changes", "Default template plan");
  },
});
