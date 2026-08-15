import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { reportKnowledgeTemplate } from "../../../instance.ts";
import { readLocalTarget } from "../../../local.ts";

export const command = defineCommand("local template apply", {
  description: "Create missing template knowledge and update eligible guides and managed pages.",
  options: {
    "force-template": {
      schema: z.boolean().optional(),
      description: "Replace eligible local directory metadata, guides, and managed pages with the template.",
    },
  },
  handler: async ({ options }) => {
    const { target } = await readLocalTarget();
    await reportKnowledgeTemplate(target, "apply", options["force-template"] ?? false);
  },
});
