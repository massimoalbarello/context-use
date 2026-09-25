import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type {
  PagePublicationStatus,
  PublicationPreparation,
  PublicationStatus,
} from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';
import { executePublication, preparePublication } from './transitions.ts';

export type PublicationRequest = {
  ownerId: string;
  readableId: string;
} & (
  | { resourceType: 'asset' | 'entity' | 'record'; action: 'publish' | 'unpublish' }
  | { resourceType: 'page'; action: 'publish'; revisionNumber: number }
  | { resourceType: 'page'; action: 'unpublish' }
);

export type PublicationTransitionResult =
  | { state: 'changed' | 'unchanged'; publication: PublicationStatus }
  | { state: 'not_found' | 'state_changed' }
  | { state: 'blocked'; blockers: PublicationPreparation['blockers'] };

export interface PublicationsRepositoryContract {
  pageStatus(input: { ownerId: string; readableId: string }): Promise<PagePublicationStatus | null>;
  entityStatus(input: { ownerId: string; readableId: string }): Promise<PublicationStatus | null>;
  assetStatus(input: { ownerId: string; readableId: string }): Promise<PublicationStatus | null>;
  recordStatus(input: { ownerId: string; readableId: string }): Promise<PublicationStatus | null>;
  prepare(input: PublicationRequest): Promise<PublicationPreparation | null>;
  execute(
    input: PublicationRequest & { expectedState: string; publishedAt: string },
  ): Promise<PublicationTransitionResult>;
}

export class PublicationsRepository implements PublicationsRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  prepare(input: PublicationRequest): Promise<PublicationPreparation | null> {
    return this.sql.begin((db) => preparePublication({ db, input }));
  }

  execute(
    input: PublicationRequest & { expectedState: string; publishedAt: string },
  ): Promise<PublicationTransitionResult> {
    return this.sql.begin('immediate', (db) => executePublication({ db, input }));
  }

  async pageStatus({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<PagePublicationStatus | null> {
    const rows = await this.sql.FindPagePublicationStatus`
      select page."public_id" as "publicId", page."published_at" as "publishedAt",
        revision."revision_number" as "publishedRevisionNumber"
      from "knowledge_page" page
      left join "knowledge_page_revision" revision
        on revision."id" = page."published_revision_id" and revision."owner_id" = page."owner_id"
        and revision."page_id" = page."id"
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
      select entity."public_id" as "publicId", entity."published_at" as "publishedAt"
      from "entity" entity
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
      select asset."public_id" as "publicId", asset."published_at" as "publishedAt"
      from "asset" asset
      where asset."owner_id" = ${ownerId} and asset."readable_id" = ${readableId}
        and asset."archived_at" is null
    `;
    return rows[0] ?? null;
  }

  async recordStatus({
    ownerId,
    readableId,
  }: {
    ownerId: string;
    readableId: string;
  }): Promise<PublicationStatus | null> {
    const rows = await this.sql.FindRecordPublicationStatus`
      select "public_id" as "publicId", "published_at" as "publishedAt"
      from "record" where "owner_id" = ${ownerId} and "readable_id" = ${readableId}
        and "deleted_at" is null
    `;
    return rows[0] ?? null;
  }
}
