import { defineCommand } from "@parshjs/core";
import { z } from "zod";
import { reportKnowledgeTemplate } from "../../../instance.ts";
import { readCloudTarget } from "../../../lifecycle.ts";

export const command = defineCommand("cloud template apply", {
  description: "Create missing template knowledge and update eligible guides and managed pages.",
  options: {
    "force-template": {
      schema: z.boolean().optional(),
      description: "Replace eligible local directory metadata, guides, and managed pages with the template.",
    },
  },
  handler: async ({ options }) => {
    const { target } = await readCloudTarget();
    await reportKnowledgeTemplate(target, "apply", options["force-template"] ?? false);
  },
});
