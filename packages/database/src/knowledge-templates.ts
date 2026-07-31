import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Actor, CreateDirectoryInput, CreatePageInput, UpdatePageInput } from "@context-use/shared";
import { DirectoryRepository } from "./directories.ts";
import { PageRepository } from "./pages.ts";

const TEMPLATES_ROOT = new URL("../templates/", import.meta.url);
const TEMPLATE_ACTOR_PREFIX = "context-use-template/";
const LEGACY_BOOTSTRAP_ACTOR = "context-use-bootstrap";

type TemplatePage = {
  id: string;
  current_path: string;
  version_number: number;
  title: string;
  summary: string;
  body_markdown: string;
  archived_at: unknown | null;
};

type TemplatePageVersion = {
  actor_subject: string;
};

export type TemplateRepositories = {
  directories: Pick<DirectoryRepository, "getByPath" | "create">;
  pages: Pick<PageRepository, "getByPath" | "create" | "update" | "version">;
};

export type TemplateAction = {
  action: "create-directory" | "create-guide" | "adopt-guide" | "update-guide" | "replace-guide" | "unchanged" | "conflict";
  path: string;
  detail: string;
};

export type TemplateResult = {
  template: string;
  applied: boolean;
  actions: TemplateAction[];
};

const RESULT_INDICATORS = {
  create: { symbol: "+", color: 32 },
  change: { symbol: "~", color: 33 },
  conflict: { symbol: "!", color: 31 },
  success: { symbol: "✓", color: 32 },
} as const;

function assertTemplateName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`Invalid template name: ${name}`);
  }
}

function titleForDirectory(path: string): string {
  if (!path) return "Knowledge";
  const segment = basename(path).replaceAll(/[-_]+/g, " ");
  return segment.slice(0, 1).toUpperCase() + segment.slice(1);
}

function guidePath(directoryPath: string): string {
  return directoryPath ? `${directoryPath}/agents` : "agents";
}

function guideSummary(directoryPath: string): string {
  return directoryPath
    ? `Instructions for maintaining knowledge in ${directoryPath}/.`
    : "The global instructions for maintaining this knowledge base.";
}

async function discoverGuideDirectories(rootPath: string): Promise<string[]> {
  const directories: string[] = [];

  async function visit(relativePath: string): Promise<void> {
    const filesystemPath = relativePath ? join(rootPath, relativePath) : rootPath;
    const entries = await readdir(filesystemPath, { withFileTypes: true });
    if (!entries.some((entry) => entry.isFile() && entry.name === "AGENTS.md")) {
      throw new Error(`Template directory ${relativePath || "/"} has no AGENTS.md`);
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name !== "AGENTS.md") {
        throw new Error(`Unexpected template file: ${join(relativePath, entry.name)}`);
      }
      if (!entry.isFile() && !entry.isDirectory()) {
        throw new Error(`Unsupported template entry: ${join(relativePath, entry.name)}`);
      }
    }
    directories.push(relativePath);
    for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      await visit(relativePath ? `${relativePath}/${entry.name}` : entry.name);
    }
  }

  await visit("");
  return directories.sort((left, right) => {
    const depth = left.split("/").filter(Boolean).length - right.split("/").filter(Boolean).length;
    return depth || left.localeCompare(right);
  });
}

function templateActor(name: string): Actor {
  return { kind: "dashboard", subject: `${TEMPLATE_ACTOR_PREFIX}${name}` };
}

function templateOwnsCurrentVersion(actorSubject: string, templateName: string): boolean {
  return actorSubject === `${TEMPLATE_ACTOR_PREFIX}${templateName}`
    || actorSubject === LEGACY_BOOTSTRAP_ACTOR;
}

function sameGuide(page: TemplatePage, input: CreatePageInput): boolean {
  return page.title === input.title
    && page.summary === input.summary
    && page.body_markdown === input.body_markdown;
}

export async function reconcileKnowledgeTemplate(
  repositories: TemplateRepositories,
  templateName = "default",
  apply = false,
  overwriteGuides = false,
): Promise<TemplateResult> {
  assertTemplateName(templateName);
  const rootUrl = new URL(`${templateName}/`, TEMPLATES_ROOT);
  const rootPath = rootUrl.pathname;
  const directoryPaths = await discoverGuideDirectories(rootPath);
  const actions: TemplateAction[] = [];
  const blockedDirectories = new Set<string>();

  for (const path of directoryPaths) {
    if (!path || await repositories.directories.getByPath(path)) continue;
    const parentPath = path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
    if (blockedDirectories.has(parentPath)) {
      blockedDirectories.add(path);
      actions.push({ action: "conflict", path, detail: "Parent template directory is unavailable" });
      continue;
    }
    if (await repositories.pages.getByPath(path)) {
      blockedDirectories.add(path);
      actions.push({ action: "conflict", path, detail: "Directory path is occupied by a page" });
      continue;
    }
    actions.push({
      action: "create-directory",
      path,
      detail: `Create ${titleForDirectory(path)}`,
    });
    if (apply) {
      const input: CreateDirectoryInput = {
        path,
        title: titleForDirectory(path),
        summary: "",
        intro_markdown: "",
      };
      await repositories.directories.create(input);
    }
  }

  for (const directoryPath of directoryPaths) {
    if (blockedDirectories.has(directoryPath)) continue;
    const path = guidePath(directoryPath);
    const bodyMarkdown = await readFile(join(rootPath, directoryPath, "AGENTS.md"), "utf8");
    const input: CreatePageInput = {
      path,
      title: "AGENTS.md",
      summary: guideSummary(directoryPath),
      body_markdown: bodyMarkdown.trimEnd() + "\n",
      commit_message: `Apply ${templateName} knowledge template`,
    };
    const existing = await repositories.pages.getByPath(path, true) as TemplatePage | null;
    if (!existing) {
      actions.push({ action: "create-guide", path, detail: "Create directory instructions" });
      if (apply) await repositories.pages.create(input, templateActor(templateName));
      continue;
    }
    if (existing.archived_at) {
      actions.push({ action: "conflict", path, detail: "Guide was archived locally" });
      continue;
    }
    const currentVersion = await repositories.pages.version(existing.id, existing.version_number) as TemplatePageVersion | null;
    if (sameGuide(existing, input)) {
      if (currentVersion?.actor_subject === `${TEMPLATE_ACTOR_PREFIX}${templateName}`) {
        actions.push({ action: "unchanged", path, detail: "Already matches the template" });
        continue;
      }
      actions.push({ action: "adopt-guide", path, detail: "Adopt matching local guide" });
      if (apply) {
        const update: UpdatePageInput = { ...input, expected_version_number: existing.version_number };
        await repositories.pages.update(existing.id, update, templateActor(templateName));
      }
      continue;
    }
    if (overwriteGuides) {
      actions.push({ action: "replace-guide", path, detail: "Overwrite locally modified guide" });
      if (apply) {
        const update: UpdatePageInput = { ...input, expected_version_number: existing.version_number };
        await repositories.pages.update(existing.id, update, templateActor(templateName));
      }
      continue;
    }
    if (!currentVersion || !templateOwnsCurrentVersion(currentVersion.actor_subject, templateName)) {
      actions.push({ action: "conflict", path, detail: "Preserve locally modified guide" });
      continue;
    }
    actions.push({ action: "update-guide", path, detail: "Update untouched template guide" });
    if (apply) {
      const update: UpdatePageInput = { ...input, expected_version_number: existing.version_number };
      await repositories.pages.update(existing.id, update, templateActor(templateName));
    }
  }

  return { template: templateName, applied: apply, actions };
}

function resultIndicator(
  kind: keyof typeof RESULT_INDICATORS,
  color: boolean,
): string {
  const { symbol, color: ansiColor } = RESULT_INDICATORS[kind];
  return color ? `\u001B[${ansiColor}m${symbol}\u001B[0m` : symbol;
}

export function formatTemplateResult(result: TemplateResult, color = false): string {
  const visible = result.actions.filter(({ action }) => action !== "unchanged");
  const lines = visible.map(({ action, path, detail }) => {
    const kind = action.startsWith("create-") ? "create"
      : action === "conflict" ? "conflict"
      : "change";
    return `${resultIndicator(kind, color)} ${action.padEnd(16)} ${path || "/"}  ${detail}`;
  });
  const conflicts = result.actions.filter(({ action }) => action === "conflict").length;
  const changes = result.actions.filter(({ action }) => action.startsWith("create-") || action === "adopt-guide" || action === "update-guide" || action === "replace-guide").length;
  const summaryKind = conflicts ? "conflict" : "success";
  lines.push(`${resultIndicator(summaryKind, color)} ${result.applied ? "Applied" : "Planned"} ${changes} change${changes === 1 ? "" : "s"}; ${conflicts} conflict${conflicts === 1 ? "" : "s"}.`);
  return lines.join("\n");
}
