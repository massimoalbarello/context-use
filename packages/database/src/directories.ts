import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CreateDirectoryInput,
  DirectoryIndex,
  DirectoryIndexEntry,
  DirectoryTree,
  DirectoryTreeNode,
  KnowledgePageMetadata,
  UpdateDirectoryInput,
} from "@context-use/shared";
import { normalizeInternalPageLinks } from "./links.ts";

export class DirectoryVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super(`Directory changed; current version is ${currentVersion}`);
    this.name = "DirectoryVersionConflictError";
  }
}

const CURRENT_DIRECTORY_SELECT = `
  SELECT id,current_path,version_number,title,summary,intro_markdown,created_at,updated_at
  FROM knowledge_directories
`;

export class DirectoryRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDirectoryInput) {
    const result = await this.pool.query(
      `INSERT INTO knowledge_directories(
         id,current_path,title,summary,intro_markdown,search_vector
       ) VALUES ($1,$2,$3,$4,$5,directory_search_vector($2,$3,$4,$5))
       RETURNING id,current_path,version_number,title,summary,intro_markdown,created_at,updated_at`,
      [randomUUID(), input.path, input.title, input.summary, normalizeInternalPageLinks(input.intro_markdown)],
    );
    return result.rows[0]!;
  }

  async update(directoryId: string, input: UpdateDirectoryInput) {
    const introMarkdown = normalizeInternalPageLinks(input.intro_markdown);
    const result = await this.pool.query(
      `UPDATE knowledge_directories
       SET title=$3,summary=$4,intro_markdown=$5,version_number=version_number+1,
           search_vector=directory_search_vector(current_path,$3,$4,$5),updated_at=now()
       WHERE id=$1 AND version_number=$2
       RETURNING id,current_path,version_number,title,summary,intro_markdown,created_at,updated_at`,
      [directoryId, input.expected_version_number, input.title, input.summary, introMarkdown],
    );
    if (result.rowCount) return result.rows[0]!;
    const current = await this.pool.query<{ version_number: number }>(
      "SELECT version_number FROM knowledge_directories WHERE id=$1",
      [directoryId],
    );
    if (!current.rowCount) return null;
    throw new DirectoryVersionConflictError(current.rows[0]!.version_number);
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
    const children = await this.pool.query<DirectoryIndexEntry>(
      `SELECT 'directory'::text AS kind,directory.id,directory.current_path AS path,
         directory.title,directory.summary,
         CASE
           WHEN trim(directory.intro_markdown)=''
             AND NOT EXISTS (
               SELECT 1 FROM knowledge_directories child
               WHERE child.parent_path=directory.current_path
             )
             AND (
               SELECT count(*) FROM knowledge_pages page
               WHERE page.parent_path=directory.current_path AND page.archived_at IS NULL
             )=1
           THEN (
             SELECT page.id FROM knowledge_pages page
             WHERE page.parent_path=directory.current_path AND page.archived_at IS NULL
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
       ORDER BY path,kind`,
      [directory.current_path],
    );
    return { ...directory, children: children.rows } as DirectoryIndex;
  }

  async indexByPath(path: string): Promise<DirectoryIndex | null> {
    const directory = await this.getByPath(path);
    return directory ? this.indexById(directory.id) : null;
  }

  async treeByPath(path: string, depth: number, maxPages: number): Promise<DirectoryTree | null> {
    const directories = await this.pool.query<{
      id: string;
      path: string;
      title: string;
      summary: string;
      depth: number;
    }>(
      `WITH RECURSIVE tree AS (
         SELECT id,current_path AS path,title,summary,0 AS depth
         FROM knowledge_directories
         WHERE current_path=$1
         UNION ALL
         SELECT child.id,child.current_path,child.title,child.summary,tree.depth+1
         FROM knowledge_directories child
         JOIN tree ON child.parent_path=tree.path
         WHERE tree.depth<$2
       )
       SELECT id,path,title,summary,depth FROM tree ORDER BY path`,
      [path, depth],
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
      max_pages: maxPages,
      truncated,
    };
  }
}
