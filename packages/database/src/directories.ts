import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CreateDirectoryInput,
  DeleteDirectoryInput,
  DirectoryIndex,
  DirectoryIndexEntry,
  DirectoryTree,
  DirectoryTreeNode,
  KnowledgePageMetadata,
  UpdateDirectoryInput,
} from "@context-use/shared";

export class DirectoryVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Directory changed; current version is ${currentVersion}`);
    this.name = "DirectoryVersionConflictError";
  }
}

export type DirectoryContents = {
  activePages: number;
  archivedPages: number;
  assets: number;
  directories: number;
};

export class DirectoryNotEmptyError extends Error {
  constructor(readonly contents: DirectoryContents) {
    const blockers = [
      contents.activePages ? `${contents.activePages} active page${contents.activePages === 1 ? "" : "s"}` : "",
      contents.archivedPages ? `${contents.archivedPages} archived page${contents.archivedPages === 1 ? "" : "s"}` : "",
      contents.assets ? `${contents.assets} asset${contents.assets === 1 ? "" : "s"}` : "",
      contents.directories ? `${contents.directories} child director${contents.directories === 1 ? "y" : "ies"}` : "",
    ].filter(Boolean);
    super(`This directory still contains ${blockers.join(", ")}. Delete all pages, assets, and child directories inside it first.`);
    this.name = "DirectoryNotEmptyError";
  }
}

export class RootDirectoryDeletionError extends Error {
  constructor() {
    super("The root knowledge directory cannot be deleted.");
    this.name = "RootDirectoryDeletionError";
  }
}

const CURRENT_DIRECTORY_SELECT = `
  SELECT id,current_path,version_number,title,summary,created_at,updated_at
  FROM knowledge_directories
`;

export class DirectoryRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDirectoryInput) {
    const result = await this.pool.query(
      `INSERT INTO knowledge_directories(
         id,current_path,title,summary,search_vector
       ) VALUES ($1,$2,$3,$4,directory_search_vector($2,$3,$4,''))
       RETURNING id,current_path,version_number,title,summary,created_at,updated_at`,
      [randomUUID(), input.path, input.title, input.summary],
    );
    return result.rows[0]!;
  }

  async update(directoryId: string, input: UpdateDirectoryInput) {
    const result = await this.pool.query(
      `UPDATE knowledge_directories
       SET title=$3,summary=$4,version_number=version_number+1,
           search_vector=directory_search_vector(current_path,$3,$4,''),updated_at=now()
       WHERE id=$1 AND version_number=$2
       RETURNING id,current_path,version_number,title,summary,created_at,updated_at`,
      [directoryId, input.expected_version_number, input.title, input.summary],
    );
    if (result.rowCount) return result.rows[0]!;
    const current = await this.pool.query<{ version_number: number }>(
      "SELECT version_number FROM knowledge_directories WHERE id=$1",
      [directoryId],
    );
    if (!current.rowCount) return null;
    throw new DirectoryVersionConflictError(current.rows[0]!.version_number);
  }

  async delete(directoryId: string, input: DeleteDirectoryInput) {
    type DeleteOutcome = {
      status: "deleted" | "not_found" | "not_empty" | "protected" | "version_conflict";
      id?: string;
      current_path?: string;
      current_version_number?: number;
      active_pages?: number;
      archived_pages?: number;
      assets?: number;
      directories?: number;
    };
    const result = await this.pool.query<{ result: DeleteOutcome }>(
      "SELECT delete_empty_knowledge_directory($1,$2) AS result",
      [directoryId, input.expected_version_number],
    );
    const outcome = result.rows[0]?.result;
    if (!outcome || outcome.status === "not_found") return null;
    if (outcome.status === "version_conflict") {
      throw new DirectoryVersionConflictError(outcome.current_version_number!);
    }
    if (outcome.status === "protected") throw new RootDirectoryDeletionError();
    if (outcome.status === "not_empty") {
      throw new DirectoryNotEmptyError({
        activePages: outcome.active_pages ?? 0,
        archivedPages: outcome.archived_pages ?? 0,
        assets: outcome.assets ?? 0,
        directories: outcome.directories ?? 0,
      });
    }
    return { id: outcome.id!, current_path: outcome.current_path! };
  }

  async get(directoryId: string) {
    const result = await this.pool.query(`${CURRENT_DIRECTORY_SELECT} WHERE id=$1`, [directoryId]);
    return result.rows[0] ?? null;
  }

  async getByPath(path: string) {
    const result = await this.pool.query(`${CURRENT_DIRECTORY_SELECT} WHERE current_path=$1`, [path]);
    return result.rows[0] ?? null;
  }

  async list(query?: string) {
    const result = query?.trim()
      ? await this.pool.query(
        `${CURRENT_DIRECTORY_SELECT}
         WHERE search_vector @@ websearch_to_tsquery('english',$1)
         ORDER BY current_path`,
        [query],
      )
      : await this.pool.query(`${CURRENT_DIRECTORY_SELECT} ORDER BY current_path`);
    return result.rows;
  }

  async hasPublishedDescendant(path: string): Promise<boolean> {
    const result = await this.pool.query<{ available: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM knowledge_pages page
         WHERE page.published_version_id IS NOT NULL
           AND page.public_path IS NOT NULL
           AND page.archived_at IS NULL
           AND ($1='' OR left(page.public_path,length($1)+1)=$1||'/')
       ) AS available`,
      [path],
    );
    return result.rows[0]?.available ?? false;
  }

  async indexById(directoryId: string): Promise<DirectoryIndex | null> {
    const directory = await this.get(directoryId);
    if (!directory) return null;
    const guidePath = directory.current_path ? `${directory.current_path}/agents` : "agents";
    const guide = await this.pool.query<KnowledgePageMetadata>(
      `SELECT page.id,page.current_path AS path,version.version_number,version.title,version.summary
       FROM knowledge_pages page
       JOIN knowledge_page_versions version
         ON version.id=page.current_version_id AND version.page_id=page.id
       WHERE page.current_path=$1 AND page.archived_at IS NULL`,
      [guidePath],
    );
    const children = await this.pool.query<DirectoryIndexEntry>(
      `SELECT 'directory'::text AS kind,directory.id,directory.current_path AS path,
         directory.title,directory.summary,
         CASE
           WHEN NOT EXISTS (
               SELECT 1 FROM knowledge_directories child
               WHERE child.parent_path=directory.current_path
             )
             AND (
               SELECT count(*) FROM knowledge_pages page
               WHERE page.parent_path=directory.current_path AND page.archived_at IS NULL
                 AND page.current_path<>directory.current_path||'/agents'
             )=1
           THEN (
             SELECT page.id FROM knowledge_pages page
             WHERE page.parent_path=directory.current_path AND page.archived_at IS NULL
               AND page.current_path<>directory.current_path||'/agents'
             LIMIT 1
           )
           ELSE NULL
         END AS default_page_id
       FROM knowledge_directories directory
       WHERE directory.parent_path=$1
       UNION ALL
       SELECT 'page'::text AS kind,page.id,page.current_path AS path,
         version.title,version.summary,NULL::uuid AS default_page_id
       FROM knowledge_pages page
       JOIN knowledge_page_versions version
         ON version.id=page.current_version_id AND version.page_id=page.id
       WHERE page.parent_path=$1 AND page.archived_at IS NULL
         AND page.current_path<>$2
       ORDER BY path,kind`,
      [directory.current_path, guidePath],
    );
    return { ...directory, guide: guide.rows[0] ?? null, children: children.rows } as DirectoryIndex;
  }

  async indexByPath(path: string): Promise<DirectoryIndex | null> {
    const directory = await this.getByPath(path);
    return directory ? this.indexById(directory.id) : null;
  }

  async treeByPath(
    path: string,
    depth: number,
    maxPages: number,
    maxDirectories: number,
  ): Promise<DirectoryTree | null> {
    const directories = await this.pool.query<{
      id: string;
      path: string;
      title: string;
      summary: string;
      depth: number;
      directories_omitted: number;
    }>(
      `WITH RECURSIVE tree AS (
         SELECT id,current_path AS path,title,summary,0 AS depth
         FROM knowledge_directories
         WHERE current_path=$1
         UNION ALL
         SELECT child.id,child.current_path,child.title,child.summary,tree.depth+1
         FROM tree
         JOIN LATERAL (
           SELECT id,current_path,title,summary
           FROM knowledge_directories
           WHERE parent_path=tree.path
           ORDER BY current_path
           LIMIT $3
         ) child ON true
         WHERE tree.depth<$2
       ), child_counts AS (
         SELECT parent_path,count(*)::integer AS total
         FROM knowledge_directories
         WHERE parent_path=ANY(SELECT path FROM tree)
         GROUP BY parent_path
       )
       SELECT tree.id,tree.path,tree.title,tree.summary,tree.depth,
         (CASE WHEN tree.depth<$2
           THEN greatest(coalesce(child_counts.total,0)-$3,0)
           ELSE 0
         END)::integer AS directories_omitted
       FROM tree
       LEFT JOIN child_counts ON child_counts.parent_path=tree.path
       ORDER BY tree.path`,
      [path, depth, maxDirectories],
    );
    if (!directories.rowCount) return null;

    const directoryPaths = directories.rows.map((directory) => directory.path);
    const guides = await this.pool.query<KnowledgePageMetadata>(
      `SELECT p.id,p.current_path AS path,v.version_number,v.title,v.summary
       FROM knowledge_pages p
       JOIN knowledge_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id
       WHERE p.parent_path=ANY($1::text[]) AND p.archived_at IS NULL
         AND p.current_path=CASE
           WHEN p.parent_path='' THEN 'agents'
           ELSE p.parent_path||'/agents'
         END
       ORDER BY p.current_path`,
      [directoryPaths],
    );
    const pages = await this.pool.query<KnowledgePageMetadata>(
      `SELECT p.id,p.current_path AS path,v.version_number,v.title,v.summary
       FROM knowledge_pages p
       JOIN knowledge_page_versions v ON v.id=p.current_version_id AND v.page_id=p.id
       WHERE p.parent_path=ANY($1::text[]) AND p.archived_at IS NULL
         AND p.current_path<>CASE
           WHEN p.parent_path='' THEN 'agents'
           ELSE p.parent_path||'/agents'
         END
       ORDER BY p.current_path
       LIMIT $2`,
      [directoryPaths, maxPages + 1],
    );
    const truncated = pages.rows.length > maxPages;
    const includedPages = pages.rows.slice(0, maxPages);
    const pagesByDirectory = new Map<string, KnowledgePageMetadata[]>();
    for (const page of [...guides.rows, ...includedPages]) {
      const parentPath = page.path.includes("/")
        ? page.path.replace(/\/[^/]+$/, "")
        : "";
      const entries = pagesByDirectory.get(parentPath) ?? [];
      entries.push(page);
      pagesByDirectory.set(parentPath, entries);
    }

    const nodes = new Map<string, DirectoryTreeNode>();
    for (const directory of directories.rows) {
      const entries = pagesByDirectory.get(directory.path) ?? [];
      const guidePath = directory.path ? `${directory.path}/agents` : "agents";
      const guide = entries.find((page) => page.path === guidePath) ?? null;
      nodes.set(directory.path, {
        id: directory.id,
        path: directory.path,
        title: directory.title,
        summary: directory.summary,
        guide,
        pages: entries.filter((page) => page !== guide),
        directories: [],
        directories_omitted: directory.directories_omitted,
      });
    }
    for (const directory of directories.rows) {
      if (directory.path === path) continue;
      const parentPath = directory.path.includes("/")
        ? directory.path.replace(/\/[^/]+$/, "")
        : "";
      const parent = nodes.get(parentPath);
      const child = nodes.get(directory.path);
      if (parent && child) parent.directories.push(child);
    }

    const root = nodes.get(path)!;
    return {
      ...root,
      requested_depth: depth,
      max_directories: maxDirectories,
      max_pages: maxPages,
      truncated: truncated || directories.rows.some((directory) => directory.directories_omitted > 0),
    };
  }
}
