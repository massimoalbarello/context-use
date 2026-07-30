import { readFile } from "node:fs/promises";
import type { Actor, CreatePageInput } from "@context-use/shared";
import { PageRepository } from "./pages.ts";
import { createPool } from "./pool.ts";

const AUTOMATION_GUIDE_PATH = "automations/agents";
const AUTOMATION_GUIDE_SOURCE = new URL(
  "../bootstrap/automations/AGENTS.md",
  import.meta.url,
);
const bootstrapActor = {
  kind: "dashboard",
  subject: "context-use-bootstrap",
} satisfies Actor;

type BootstrapPageRepository = {
  getByPath(path: string, includeArchived?: boolean): Promise<unknown | null>;
  create(input: CreatePageInput, actor: Actor): Promise<unknown>;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as Error & { code: unknown }).code === "23505";
}

export async function ensureAutomationGuide(
  pages: BootstrapPageRepository,
  bodyMarkdown: string,
): Promise<boolean> {
  if (await pages.getByPath(AUTOMATION_GUIDE_PATH, true)) return false;

  try {
    await pages.create({
      path: AUTOMATION_GUIDE_PATH,
      title: "AGENTS.md",
      summary: "The naming and storage conventions for automation instructions and supporting assets.",
      body_markdown: bodyMarkdown,
      commit_message: "Create automation directory guide",
    }, bootstrapActor);
    return true;
  } catch (error) {
    // A concurrent initializer may have won the active-path race. Treat that
    // as success, but surface collisions with another kind of knowledge.
    if (isUniqueViolation(error) && await pages.getByPath(AUTOMATION_GUIDE_PATH, true)) {
      return false;
    }
    throw error;
  }
}

export async function bootstrapKnowledge(
  pages: BootstrapPageRepository,
): Promise<void> {
  const automationGuide = await readFile(AUTOMATION_GUIDE_SOURCE, "utf8");
  await ensureAutomationGuide(pages, automationGuide);
}

export async function runKnowledgeBootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to bootstrap knowledge");

  const pool = createPool(databaseUrl, {
    application_name: "context-use-knowledge-bootstrap",
  });
  try {
    await bootstrapKnowledge(new PageRepository(pool));
  } finally {
    await pool.end();
  }
}

if (import.meta.main) await runKnowledgeBootstrap();
