import { pathToFileURL } from "node:url";
import { DirectoryRepository } from "./directories.ts";
import { reconcileKnowledgeTemplate, formatTemplateResult } from "./knowledge-templates.ts";
import { PageRepository } from "./pages.ts";
import { createPool } from "./pool.ts";

export async function runTemplateCommand(
  action: "plan" | "apply",
  templateName = "default",
  forceTemplate = false,
  templatesRoot?: string,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to manage knowledge templates");
  const pool = createPool(databaseUrl, { application_name: "context-use-knowledge-template" });
  try {
    const result = await reconcileKnowledgeTemplate({
      directories: new DirectoryRepository(pool),
      pages: new PageRepository(pool),
    }, templateName, action === "apply", forceTemplate, templatesRoot
      ? pathToFileURL(templatesRoot.endsWith("/") ? templatesRoot : `${templatesRoot}/`)
      : undefined);
    console.log(formatTemplateResult(result, !("NO_COLOR" in process.env)));
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "plan" && action !== "apply") throw new Error("Expected template action: plan or apply");
  const templateName = process.argv[3] ?? "default";
  const extraArguments = process.argv.slice(4);
  const knownArguments = new Set(["--force-template"]);
  if (extraArguments.some((argument) => !knownArguments.has(argument))) {
    throw new Error("Unknown template command option");
  }
  await runTemplateCommand(
    action,
    templateName,
    extraArguments.includes("--force-template"),
  );
}
