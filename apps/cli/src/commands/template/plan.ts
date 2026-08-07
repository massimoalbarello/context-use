import * as p from "@clack/prompts";
import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { runKnowledgeTemplateCommand } from "../../knowledge-template.ts";

export const command = defineCommand("template plan", {
  description: "Preview safe default-template changes and local conflicts.",
  options: {
    "force-template": {
      schema: z.boolean().optional(),
      description: "Preview replacement of eligible local directory metadata, guides, and managed pages.",
    },
  },
  handler: async ({ options }) => {
    const output = (await runKnowledgeTemplateCommand("plan", {
      forceTemplate: options["force-template"] ?? false,
    })).trim();
    p.note(output || "No template changes", "Default template plan");
  },
});
