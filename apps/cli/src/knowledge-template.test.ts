import { expect, test } from "bun:test";
import { knowledgeTemplateCommands } from "./knowledge-template.ts";
import { cloudTarget, localTarget } from "./target.ts";
import type { DeploymentConfig } from "./types.ts";

const cloud = cloudTarget({ hostname: "context.example.com", awsProfile: "p", awsRegion: "eu-west-2" } as DeploymentConfig, "i-1");
const local = localTarget({
  origin: "http://localhost:5173",
  deployDirectory: "/home/a b/.cache/context-use/releases/v0.1.69/deploy",
  runtimeEnvPath: "/home/a b/.config/context-use/local/runtime.env",
});

test("template commands use the installed application image without updating the deployment", () => {
  expect(knowledgeTemplateCommands(cloud, "plan")).toEqual([
    "set -euo pipefail",
    "cd '/opt/context-use/deploy'",
    "docker compose --env-file '/data/context-use/secrets/runtime.env' --profile migration run --rm migrate bun packages/database/src/template-command.ts plan default",
  ]);
  expect(knowledgeTemplateCommands(cloud, "apply").at(-1)).toEndWith("template-command.ts apply default");
  expect(knowledgeTemplateCommands(cloud, "apply", "default", true).at(-1))
    .toEndWith("template-command.ts apply default --force-template");
  expect(() => knowledgeTemplateCommands(cloud, "apply", "../other")).toThrow("Invalid template name");
});

test("the same template shell targets a local deployment directory that contains spaces", () => {
  expect(knowledgeTemplateCommands(local, "plan")).toEqual([
    "set -euo pipefail",
    "cd '/home/a b/.cache/context-use/releases/v0.1.69/deploy'",
    "docker compose --env-file '/home/a b/.config/context-use/local/runtime.env' --profile migration run --rm migrate bun packages/database/src/template-command.ts plan default",
  ]);
});
