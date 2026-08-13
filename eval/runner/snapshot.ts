import { LOCAL_STACK } from "../../scripts/local-stack.ts";
import { ROOT } from "./agent.ts";

export type PageSnapshot = {
  id: string;
  parentDirectoryId?: string;
  path: string;
  version: number;
  title: string;
  summary: string;
  body: string;
};

export type DirectorySnapshot = {
  id: string;
  path: string;
  version: number;
  title: string;
  summary: string;
};

export type KnowledgeSnapshot = {
  pages: PageSnapshot[];
  directories: DirectorySnapshot[];
};

/** Reads every active knowledge page straight from the local database. */
export function snapshotKnowledge(): PageSnapshot[] {
  const sql = `SELECT COALESCE(json_agg(json_build_object(
    'id', p.id,
    'parentDirectoryId', d.id,
    'path', p.current_path,
    'version', v.version_number,
    'title', v.title,
    'summary', v.summary,
    'body', v.body_markdown
  ) ORDER BY p.current_path), '[]'::json)::text
  FROM knowledge_pages p
  JOIN knowledge_directories d ON d.current_path=p.parent_path
  JOIN knowledge_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id
  WHERE p.archived_at IS NULL;`;
  const child = Bun.spawnSync([
    "docker", "compose", "--project-name", LOCAL_STACK.project, "exec", "-T",
    "postgres", "psql", "-U", "postgres", "-d", LOCAL_STACK.database, "-Atc", sql,
  ], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) {
    throw new Error(`Could not snapshot the eval knowledge base:\n${child.stderr.toString()}`);
  }
  return JSON.parse(child.stdout.toString().trim()) as PageSnapshot[];
}

/** Reads pages and their stable containing directories for path-independent story scoring. */
export function snapshotKnowledgeState(): KnowledgeSnapshot {
  const pages = snapshotKnowledge();
  const sql = `SELECT COALESCE(json_agg(json_build_object(
    'id', id,
    'path', current_path,
    'version', version_number,
    'title', title,
    'summary', summary
  ) ORDER BY current_path), '[]'::json)::text
  FROM knowledge_directories;`;
  const child = Bun.spawnSync([
    "docker", "compose", "--project-name", LOCAL_STACK.project, "exec", "-T",
    "postgres", "psql", "-U", "postgres", "-d", LOCAL_STACK.database, "-Atc", sql,
  ], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (child.exitCode !== 0) {
    throw new Error(`Could not snapshot the eval knowledge directories:\n${child.stderr.toString()}`);
  }
  const directories = JSON.parse(child.stdout.toString().trim()) as DirectorySnapshot[];
  return { pages, directories };
}

export type PageChange = { path: string; version: number; change: "created" | "updated" };

/** Compares two snapshots so a run can report what it actually wrote. */
export function pageChanges(before: PageSnapshot[], after: PageSnapshot[]): PageChange[] {
  const previous = new Map(before.map((page) => [page.path, page.version]));
  const changes: PageChange[] = [];
  for (const page of after) {
    const priorVersion = previous.get(page.path);
    if (priorVersion === undefined) changes.push({ path: page.path, version: page.version, change: "created" });
    else if (page.version > priorVersion) changes.push({ path: page.path, version: page.version, change: "updated" });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
