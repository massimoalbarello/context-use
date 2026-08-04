import { expect, test } from "bun:test";
import { knowledgeTemplateCommands } from "./knowledge-template.ts";

test("template commands use the installed application image without updating the deployment", () => {
  expect(knowledgeTemplateCommands("plan")).toEqual([
    "set -euo pipefail",
    "cd /opt/context-use/deploy",
    "docker compose --env-file /data/context-use/secrets/runtime.env --profile migration run --rm migrate bun packages/database/src/template-command.ts plan default",
  ]);
  expect(knowledgeTemplateCommands("apply").at(-1)).toEndWith("template-command.ts apply default");
  expect(knowledgeTemplateCommands("apply", "default", true).at(-1))
    .toEndWith("template-command.ts apply default --overwrite-guides");
  expect(knowledgeTemplateCommands("apply", "default", false, true).at(-1))
    .toEndWith("template-command.ts apply default --overwrite-managed-pages");
  expect(knowledgeTemplateCommands("apply", "default", true, true).at(-1))
    .toEndWith("template-command.ts apply default --overwrite-guides --overwrite-managed-pages");
  expect(() => knowledgeTemplateCommands("apply", "../other")).toThrow("Invalid template name");
});
