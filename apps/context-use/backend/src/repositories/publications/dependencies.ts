import type { TypedTransactionSQL } from '@ilbertt/bun-sqlgen';
import type { PublicationBlocker } from '#backend/models/publications/model.ts';
import type { Queries } from '#backend/queries.gen.ts';

export async function withdrawalBlockers({
  db,
  ...input
}: {
  db: TypedTransactionSQL<Queries>;
  ownerId: string;
  resourceType: 'asset' | 'entity';
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
    )
    select page."readable_id" as "readableId", revision."title" as "name"
    from referring_revisions reference
    join "knowledge_page" page
      on page."published_revision_id" = reference."source_revision_id"
      and page."owner_id" = ${input.ownerId} and page."published_at" is not null
    join "knowledge_page_revision" revision
      on revision."id" = page."published_revision_id" and revision."owner_id" = page."owner_id"
      and revision."page_id" = page."id"
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
