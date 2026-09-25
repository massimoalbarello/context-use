import type { TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import type { PublicationBlocker } from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export async function withdrawalBlockers({
  db,
  ...input
}: {
  db: TypedTransactionSQL<Queries>;
  ownerId: string;
  resourceType: 'asset' | 'entity' | 'page';
  id: string;
}): Promise<PublicationBlocker[]> {
  const pages = await db.FindPublicationReferringPages`
    /* @notNull readableId name */
    with referring_revisions as (
      select "source_revision_id" from "knowledge_page_asset_usage"
      where "owner_id" = ${input.ownerId} and "target_asset_id" = ${input.id}
        and ${input.resourceType} = 'asset'
      union
      select "source_revision_id" from "knowledge_page_entity_mention"
      where "owner_id" = ${input.ownerId} and "target_entity_id" = ${input.id}
        and ${input.resourceType} = 'entity'
      union
      select "source_revision_id" from "knowledge_page_reference"
      where "owner_id" = ${input.ownerId} and "target_page_id" = ${input.id}
        and ${input.resourceType} = 'page'
    )
    select page."readable_id" as "readableId", revision."title" as "name"
    from referring_revisions reference
    join "knowledge_page" page
      on page."published_revision_id" = reference."source_revision_id"
      and page."owner_id" = ${input.ownerId} and page."published_at" is not null
    join "knowledge_page_revision" revision
      on revision."id" = page."published_revision_id" and revision."owner_id" = page."owner_id"
      and revision."page_id" = page."id"
    where ${input.resourceType} != 'page' or page."id" != ${input.id}
    order by page."readable_id"
  `;
  const blockers: PublicationBlocker[] = pages.map((page) => ({
    reason: 'public_page_reference',
    resource: { resourceType: 'page', ...page },
  }));
  if (input.resourceType === 'asset') {
    const entities = await db.FindPublicationPortraitEntities`
      /* @notNull readableId name */
      select entity."readable_id" as "readableId", entity."name"
      from "entity" entity
      where entity."owner_id" = ${input.ownerId} and entity."image_asset_id" = ${input.id}
        and entity."published_at" is not null
      order by entity."readable_id"
    `;
    blockers.push(
      ...entities.map((entity) => ({
        reason: 'public_entity_image' as const,
        resource: { resourceType: 'entity' as const, ...entity },
      })),
    );
  }
  return blockers;
}

export async function pagePublicationBlockers({
  db,
  ownerId,
  revisionId,
}: {
  db: TypedTransactionSQL<Queries>;
  ownerId: string;
  revisionId: string;
}): Promise<PublicationBlocker[]> {
  const references = await db.FindPagePublicationDependencies`
    /* @notNull resourceType readableId name */
    /* @type resourceType 'page' | 'entity' | 'asset' */
    with dependencies as (
      select 'page' as "resourceType", page."readable_id" as "readableId",
        revision."title" as "name", page."archived_at" as "archivedAt",
        page."published_at" as "publishedAt"
      from "knowledge_page_reference" reference
      join "knowledge_page" page
        on page."id" = reference."target_page_id" and page."owner_id" = reference."owner_id"
      join "knowledge_page_revision" revision
        on revision."id" = page."current_revision_id" and revision."owner_id" = page."owner_id"
      where reference."owner_id" = ${ownerId} and reference."source_revision_id" = ${revisionId}
      union
      select 'entity', entity."readable_id", entity."name", entity."archived_at", entity."published_at"
      from "knowledge_page_entity_mention" mention
      join "entity" entity
        on entity."id" = mention."target_entity_id" and entity."owner_id" = mention."owner_id"
      where mention."owner_id" = ${ownerId} and mention."source_revision_id" = ${revisionId}
      union
      select 'asset', asset."readable_id", asset."name", asset."archived_at", asset."published_at"
      from "knowledge_page_asset_usage" usage
      join "asset" asset
        on asset."id" = usage."target_asset_id" and asset."owner_id" = usage."owner_id"
      where usage."owner_id" = ${ownerId} and usage."source_revision_id" = ${revisionId}
    )
    select * from dependencies
    where "publishedAt" is null or "archivedAt" is not null
    order by "resourceType", "readableId"
  `;
  const blockers: PublicationBlocker[] = references.map((reference) => ({
    reason: reference.archivedAt ? 'reference_unavailable' : 'reference_not_public',
    resource: {
      resourceType: reference.resourceType,
      readableId: reference.readableId,
      name: reference.name,
    },
  }));
  const records = await db.FindPagePublicationRecordReferences`
    /* @notNull readableId */
    select "target_record_readable_id" as "readableId"
    from "knowledge_page_record_reference"
    where "owner_id" = ${ownerId} and "source_revision_id" = ${revisionId}
    order by "target_record_readable_id"
  `;
  blockers.push(
    ...records.map((record) => ({
      reason: 'record_reference' as const,
      resource: {
        resourceType: 'record' as const,
        readableId: record.readableId,
        name: record.readableId,
      },
    })),
  );
  return blockers;
}
