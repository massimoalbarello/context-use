import { defineCommand } from "@parshjs/core";
import { instanceTypeSchema } from "../instance-type.ts";
import { setup } from "../setup.ts";

export const command = defineCommand("setup", {
  description: "Create a new AWS deployment.",
  options: {
    "instance-type": {
      schema: instanceTypeSchema.optional(),
      description: "EC2 type with at least 2 vCPU and 4 GiB RAM (default: t3.large).",
    },
  },
  handler: ({ options }) => setup(options["instance-type"]
    ? { instanceType: options["instance-type"] }
    : {}),
});
