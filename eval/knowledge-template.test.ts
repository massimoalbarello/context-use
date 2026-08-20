import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  reconcileKnowledgeTemplate,
  type TemplateRepositories,
} from "../packages/database/src/knowledge-templates.ts";
import { ROOT } from "./runner/agent.ts";
import {
  knowledgeTemplateInstall,
  knowledgeTemplateSourceDirectory,
} from "./knowledge-template.ts";

describe("eval knowledge templates", () => {
  test("the greedy template is complete and accepted by the product template reader", async () => {
    const repositories = {
      directories: {
        getByPath: async (path: string) => path === "" ? {
          id: "root",
          current_path: "",
          version_number: 1,
          title: "Knowledge",
          summary: "The root of the owner's private, progressively discoverable knowledge base.",
        } : null,
        create: async () => { throw new Error("plan must not write"); },
        update: async () => { throw new Error("plan must not write"); },
      },
      pages: {
        getByPath: async () => null,
        create: async () => { throw new Error("plan must not write"); },
        update: async () => { throw new Error("plan must not write"); },
        archive: async () => { throw new Error("plan must not write"); },
        version: async () => null,
      },
    } as unknown as TemplateRepositories;
    const templatesRoot = pathToFileURL(`${ROOT}/eval/templates/`);

    const result = await reconcileKnowledgeTemplate(
      repositories,
      "greedy",
      false,
      false,
      templatesRoot,
    );

    expect(result.template).toBe("greedy");
    expect(result.actions.map((action) => action.path)).toEqual(expect.arrayContaining([
      "agents",
      "automations/agents",
      "automations/activity-distiller/instructions",
      "automations/activity-distiller/state",
    ]));
  });

  test("greedy is available to local evals but absent from the production image inputs", () => {
    expect(existsSync(knowledgeTemplateSourceDirectory("greedy"))).toBe(true);
    expect(knowledgeTemplateInstall("greedy")).toEqual({
      name: "greedy",
      root: "/app/eval/templates",
    });
    expect(existsSync(`${ROOT}/packages/database/templates/greedy`)).toBe(false);

    const dockerfile = readFileSync(`${ROOT}/Dockerfile`, "utf8");
    expect(dockerfile).not.toMatch(/^COPY eval(?:\s|\/)/m);
    expect(dockerfile).toMatch(/^COPY packages \.\/packages$/m);

    const deployedCompose = readFileSync(`${ROOT}/deploy/docker-compose.yml`, "utf8");
    expect(deployedCompose).not.toContain("CONTEXT_USE_DEVELOPMENT_TEMPLATE_ROOT");

    const initialize = readFileSync(`${ROOT}/packages/database/src/initialize.ts`, "utf8");
    expect(initialize).toContain("Development knowledge templates are unavailable in production");
  });
});
