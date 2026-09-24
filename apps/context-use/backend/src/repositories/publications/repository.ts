import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  PagePublicationStatus,
  PublicationStatus,
} from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export interface PublicationsRepositoryContract {
  pageStatus(input: { ownerId: string; readableId: string }): Promise<PagePublicationStatus | null>;
  entityStatus(input: { ownerId: string; readableId: string }): Promise<PublicationStatus | null>;
  assetStatus(input: { ownerId: string; readableId: string }): Promise<PublicationStatus | null>;
}

export class PublicationsRepository implements PublicationsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async pageStatus({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<PagePublicationStatus | null> {
    const rows = await this.sql.FindPagePublicationStatus`
      select publication."public_id" as "publicId", publication."published_at" as "publishedAt",
        publication."revision_id" as "revisionId"
      from "knowledge_page" page
      left join "knowledge_page_publication" publication
        on publication."page_id" = page."id" and publication."owner_id" = page."owner_id"
      where page."owner_id" = ${ownerId} and page."readable_id" = ${readableId}
        and page."archived_at" is null
    `;
    return rows[0] ?? null;
  }

  async entityStatus({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<PublicationStatus | null> {
    const rows = await this.sql.FindEntityPublicationStatus`
      select publication."public_id" as "publicId", publication."published_at" as "publishedAt"
      from "entity" entity
      left join "entity_publication" publication
        on publication."entity_id" = entity."id" and publication."owner_id" = entity."owner_id"
      where entity."owner_id" = ${ownerId} and entity."readable_id" = ${readableId}
        and entity."archived_at" is null
    `;
    return rows[0] ?? null;
  }

  async assetStatus({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<PublicationStatus | null> {
    const rows = await this.sql.FindAssetPublicationStatus`
      select publication."public_id" as "publicId", publication."published_at" as "publishedAt"
      from "asset" asset
      left join "asset_publication" publication
        on publication."asset_id" = asset."id" and publication."owner_id" = asset."owner_id"
      where asset."owner_id" = ${ownerId} and asset."readable_id" = ${readableId}
        and asset."archived_at" is null
    `;
    return rows[0] ?? null;
  }
}
