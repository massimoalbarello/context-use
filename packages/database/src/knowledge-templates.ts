import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Actor,
  CreateDirectoryInput,
  CreatePageInput,
  UpdateDirectoryInput,
  UpdatePageInput,
} from "@context-use/shared";
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

type TemplateDirectory = {
  id: string;
  current_path: string;
  version_number: number;
  title: string;
  summary: string;
  intro_markdown: string;
};

type TemplateDirectoryPresentation = {
  title: string;
  summary: string;
};

export type TemplateRepositories = {
  directories: Pick<DirectoryRepository, "getByPath" | "create" | "update">;
  pages: Pick<PageRepository, "getByPath" | "create" | "update" | "version">;
};

export type TemplateAction = {
  action: "create-directory" | "update-directory" | "create-guide" | "adopt-guide" | "update-guide" | "replace-guide" | "unchanged" | "conflict";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readDirectoryPresentations(
  rootPath: string,
  directoryPaths: string[],
): Promise<Map<string, TemplateDirectoryPresentation>> {
  const source = await readFile(join(rootPath, "directories.json"), "utf8");
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error("Template directories.json must contain an object");

  const knownPaths = new Set(directoryPaths);
  for (const path of Object.keys(parsed)) {
    if (!knownPaths.has(path)) throw new Error(`Template directory metadata has no matching guide: ${path || "/"}`);
  }

  const presentations = new Map<string, TemplateDirectoryPresentation>();
  for (const path of directoryPaths) {
    const presentation = parsed[path];
    if (!isRecord(presentation)) throw new Error(`Template directory metadata is missing: ${path || "/"}`);
    const { title, summary } = presentation;
    if (typeof title !== "string" || !title.trim() || title.length > 240 || /[\r\n]/.test(title)) {
      throw new Error(`Invalid template directory title: ${path || "/"}`);
    }
    if (typeof summary !== "string" || !summary.trim() || summary.length > 320 || /[\r\n]/.test(summary)) {
      throw new Error(`Invalid template directory summary: ${path || "/"}`);
    }
    presentations.set(path, { title: title.trim(), summary: summary.trim() });
  }
  return presentations;
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
      const isRootMetadata = !relativePath && entry.isFile() && entry.name === "directories.json";
      if (entry.isFile() && entry.name !== "AGENTS.md" && !isRootMetadata) {
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
  const directoryPresentations = await readDirectoryPresentations(rootPath, directoryPaths);
  const actions: TemplateAction[] = [];
  const blockedDirectories = new Set<string>();

  for (const path of directoryPaths) {
    const presentation = directoryPresentations.get(path)!;
    const existing = await repositories.directories.getByPath(path) as TemplateDirectory | null;
    if (existing) {
      if (existing.summary.trim()) continue;
      actions.push({
        action: "update-directory",
        path,
        detail: `Add template summary for ${existing.title}`,
      });
      if (apply) {
        const input: UpdateDirectoryInput = {
          title: existing.title,
          summary: presentation.summary,
          intro_markdown: existing.intro_markdown,
          expected_version_number: existing.version_number,
        };
        await repositories.directories.update(existing.id, input);
      }
      continue;
    }
    if (!path) continue;
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
      detail: `Create ${presentation.title}`,
    });
    if (apply) {
      const input: CreateDirectoryInput = {
        path,
        title: presentation.title,
        summary: presentation.summary,
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
  const changes = result.actions.filter(({ action }) => action.startsWith("create-") || action.startsWith("update-") || action === "adopt-guide" || action === "replace-guide").length;
  const summaryKind = conflicts ? "conflict" : "success";
  lines.push(`${resultIndicator(summaryKind, color)} ${result.applied ? "Applied" : "Planned"} ${changes} change${changes === 1 ? "" : "s"}; ${conflicts} conflict${conflicts === 1 ? "" : "s"}.`);
  return lines.join("\n");
}
