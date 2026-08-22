import { pathToFileURL } from "node:url";
import { DirectoryRepository } from "./directories.ts";
import { reconcileKnowledgeTemplate, formatTemplateResult } from "./knowledge-templates.ts";
import { PageRepository } from "./pages.ts";
import { createPool } from "./pool.ts";
import type { MarkdownObjectStore } from "./documents.ts";

export async function runTemplateCommand(
  action: "plan" | "apply",
  templateName = "default",
  forceTemplate = false,
  bodies: MarkdownObjectStore,
  templatesRoot?: string,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to manage knowledge templates");
  const pool = createPool(databaseUrl, { application_name: "context-use-knowledge-template" });
  try {
    const result = await reconcileKnowledgeTemplate({
      directories: new DirectoryRepository(pool),
      pages: new PageRepository(pool, bodies),
    }, templateName, action === "apply", forceTemplate, templatesRoot
      ? pathToFileURL(templatesRoot.endsWith("/") ? templatesRoot : `${templatesRoot}/`)
      : undefined);
    console.log(formatTemplateResult(result, !("NO_COLOR" in process.env)));
  } finally {
    await pool.end();
  }
}
