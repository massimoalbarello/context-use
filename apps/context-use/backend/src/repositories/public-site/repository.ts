import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#backend/queries.gen.ts';

export interface PublicHomepage {
  readableId: string;
  publicId: string;
  title: string;
}

export interface PublicSiteRepositoryContract {
  homepage(input: { ownerId: string }): Promise<PublicHomepage | null>;
  setHomepage(input: { ownerId: string; readableId: string | null }): Promise<boolean>;
}

export class PublicSiteRepository implements PublicSiteRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async homepage({ ownerId }: { ownerId: string }): Promise<PublicHomepage | null> {
    const rows = await this.sql.FindPublicHomepage`
      /* @notNull readableId publicId title */
      select page."readable_id" as "readableId", page."public_id" as "publicId", revision."title"
      from "knowledge_page" page
      join "knowledge_page_revision" revision on revision."id" = page."published_revision_id"
        and revision."page_id" = page."id" and revision."owner_id" = page."owner_id"
      where page."owner_id" = ${ownerId} and page."public_homepage" = 1
        and page."published_at" is not null and page."archived_at" is null
    `;
    return rows[0] ?? null;
  }

  setHomepage({ ownerId, readableId }: { ownerId: string; readableId: string | null }) {
    return this.sql.begin('immediate', async (db) => {
      if (readableId !== null) {
        const candidates = await db.FindHomepageCandidate`
          select "id" from "knowledge_page"
          where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
            and "published_at" is not null and "archived_at" is null
        `;
        if (!candidates.length) {
          return false;
        }
      }
      await db.ClearPublicHomepage`
        update "knowledge_page" set "public_homepage" = 0
        where "owner_id" = ${ownerId} and "public_homepage" = 1
      `;
      if (readableId !== null) {
        await db.SetPublicHomepage`
          update "knowledge_page" set "public_homepage" = 1
          where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
        `;
      }
      return true;
    });
  }
}
