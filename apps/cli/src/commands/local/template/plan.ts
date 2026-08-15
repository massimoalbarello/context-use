import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { reportKnowledgeTemplate } from "../../../instance.ts";
import { readLocalTarget } from "../../../local.ts";

export const command = defineCommand("local template plan", {
  description: "Preview safe default-template changes and local conflicts.",
  options: {
    "force-template": {
      schema: z.boolean().optional(),
      description: "Preview replacement of eligible local directory metadata, guides, and managed pages.",
    },
  },
  handler: async ({ options }) => {
    const { target } = await readLocalTarget();
    await reportKnowledgeTemplate(target, "plan", options["force-template"] ?? false);
  },
});
