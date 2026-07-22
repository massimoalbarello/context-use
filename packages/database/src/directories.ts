import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  CreateDirectoryInput,
  DirectoryIndex,
  DirectoryIndexEntry,
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
      `SELECT 'directory'::text AS kind,id,current_path AS path,title,summary
       FROM knowledge_directories
       WHERE parent_path=$1
       UNION ALL
       SELECT 'page'::text AS kind,page.id,page.current_path AS path,version.title,version.summary
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
}
