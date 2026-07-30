import { describe, expect, test } from "bun:test";
import type { Actor, CreatePageInput } from "@context-use/shared";
import {
  bootstrapKnowledge,
  ensureAutomationGuide,
} from "./bootstrap-knowledge.ts";

type CreatedPage = {
  input: CreatePageInput;
  actor: Actor;
};

describe("default knowledge bootstrap", () => {
  test("creates the automation guide as an ordinary private page", async () => {
    const created: CreatedPage[] = [];
    await bootstrapKnowledge({
      async getByPath() {
        return null;
      },
      async create(input, actor) {
        created.push({ input, actor });
        return { id: "created" };
      },
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      input: {
        path: "automations/agents",
        title: "AGENTS.md",
        summary: "The naming and storage conventions for automation instructions and supporting assets.",
        commit_message: "Create automation directory guide",
      },
      actor: {
        kind: "dashboard",
        subject: "context-use-bootstrap",
      },
    });
    expect(created[0]?.input.body_markdown).toContain(
      "automations/<automation-name>/instructions",
    );
  });

  test("never overwrites or recreates an existing owner-authored guide", async () => {
    let creates = 0;
    const includeArchived: boolean[] = [];
    expect(await ensureAutomationGuide({
      async getByPath(_path, include) {
        includeArchived.push(include ?? false);
        return { id: "owner-guide", archived_at: new Date() };
      },
      async create() {
        creates += 1;
        return {};
      },
    }, "Default guide")).toBe(false);
    expect(creates).toBe(0);
    expect(includeArchived).toEqual([true]);
  });

  test("tolerates only a concurrent initializer winning the path race", async () => {
    let reads = 0;
    expect(await ensureAutomationGuide({
      async getByPath() {
        reads += 1;
        return reads === 1 ? null : { id: "concurrent-guide" };
      },
      async create() {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      },
    }, "Default guide")).toBe(false);

    await expect(ensureAutomationGuide({
      async getByPath() {
        return null;
      },
      async create() {
        throw Object.assign(new Error("different path collision"), { code: "23505" });
      },
    }, "Default guide")).rejects.toThrow("different path collision");
  });
});
