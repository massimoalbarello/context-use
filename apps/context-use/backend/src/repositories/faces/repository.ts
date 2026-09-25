import type { Database } from 'bun:sqlite';
import { matchFace, reconcileFaces } from '#backend/models/faces/matching.ts';
import type { FaceBox, FaceDecision } from '#backend/models/faces/model.ts';
import { entityTypeFrom } from '#backend/views/entities/entity-view.ts';
import type { FaceAssetInput, FacesRepositoryContract, StoredFace } from './contract.ts';
import { recordFaceAnnotationChange } from './history.ts';
import { type FaceSqlite, withTypes } from './sqlite.ts';

const WRITE_RETRY_MS = 10;
const WRITE_WAIT_MS = 2000;

type Input<Method extends keyof FacesRepositoryContract> = Parameters<
  FacesRepositoryContract[Method]
>[0];

function vectorBytes(vector: number[]): Uint8Array {
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (const [index, value] of vector.entries()) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true);
  }
  return bytes;
}

function vectorFrom(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    values.push(view.getFloat32(offset, true));
  }
  return values;
}

function readObservations({
  database,
  ownerId,
  assetId,
}: FaceAssetInput & { database: Database }): StoredFace[] {
  const db = withTypes(database);
  const rows = db.ReadFaceObservations`
    /* @notNull id readableId assetId box cropKey detectionScore analysisVersion current needsReview embeddingSpace embeddingRevision vector protected */
    select face."id", face."readable_id" as "readableId", face."asset_id" as "assetId", face."box",
      face."crop_key" as "cropKey", face."detection_score" as "detectionScore", face."analysis_version" as "analysisVersion",
      face."current", face."needs_review" as "needsReview", face."embedding_space" as "embeddingSpace", face."embedding_revision" as "embeddingRevision", face."embedding" as "vector",
      (face."annotation_decision" is not null
       or exists(select 1 from "entity_face_reference" where "face_id" = face."id" and "owner_id" = face."owner_id")) as "protected"
    from "asset_face" face
    where face."owner_id" = ${ownerId} and face."asset_id" = ${assetId}
    order by face."readable_id"
  `;
  return rows.map((row) => ({
    ...row,
    box: JSON.parse(row.box) as FaceBox,
    embedding: vectorFrom(row.vector),
    detectionScore: Number(row.detectionScore),
    current: Boolean(row.current),
    needsReview: Boolean(row.needsReview),
    protected: Boolean(row.protected),
  }));
}

/** Dedicated synchronous transactions cannot block another writer across a JavaScript await. */
export class FacesRepository implements FacesRepositoryContract {
  private readonly sql: FaceSqlite;
  private readonly database: Database;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(database: Database) {
    this.database = database;
    this.sql = withTypes(database);
  }

  private run<T>(operation: () => T): Promise<T> {
    const result = this.tail.then(async () => {
      const deadline = Date.now() + WRITE_WAIT_MS;
      for (;;) {
        try {
          return operation();
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'SQLITE_BUSY' ||
            Date.now() >= deadline
          ) {
            throw error;
          }
          await Bun.sleep(WRITE_RETRY_MS);
        }
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  detail(input: Input<'detail'>) {
    return this.run(() => {
      const analyses = this.sql.ReadFaceAnalysis`
        /* @notNull state analysisVersion */
        /* @type state 'processing' | 'ready' | 'failed' */
        select "state", "error", "analysis_version" as "analysisVersion" from "asset_face_analysis"
        where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}
        order by ("analysis_version" = ${input.analysisVersion}) desc, "updated_at" desc limit 1
      `;
      const rows = this.sql.ReadAssetFaceViews`
        /* @notNull readableId box current needsReview */
        /* @type similarity number | null */
        select face."readable_id" as "readableId", face."box", face."current", face."needs_review" as "needsReview",
          face."annotation_decision" as "decision", entity."id" as "entityId", entity."readable_id" as "entityReadableId",
          entity."name", entity."description", entity."entity_type" as "entityType",
          entity."public_id" as "publicId", entity."published_at" as "publishedAt",
          profile."self_entity_id" as "selfEntityId",
          case when face."annotation_decision" is null and entity."id" is not null then face."match_similarity" end as "similarity"
        from "asset_face" face
        left join "asset_depicts_entity" link on link."face_id" = face."id" and link."owner_id" = face."owner_id"
        left join "entity" entity on entity."id" = link."entity_id" and entity."owner_id" = link."owner_id" and entity."archived_at" is null and entity."entity_type" = 'person'
        left join "knowledge_profile" profile on profile."self_entity_id" = entity."id" and profile."owner_id" = entity."owner_id"
        where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId}
          and (face."current" = 1 or face."annotation_decision" is not null)
        order by face."readable_id"
      `;
      const analysis = analyses[0];
      return {
        state: analysis?.state ?? ('not_processed' as const),
        error: analysis?.error ?? null,
        analysisVersion: analysis?.analysisVersion ?? null,
        faces: rows.map((row) => ({
          readableId: row.readableId,
          box: JSON.parse(row.box) as FaceBox,
          decision: (row.decision ?? 'automatic') as FaceDecision,
          needsReview: Boolean(row.needsReview) || !row.current,
          similarity: row.similarity === null ? null : Number(row.similarity),
          entity:
            row.entityId && row.entityReadableId && row.name !== null && row.description !== null
              ? {
                  publicId: row.publicId,
                  publishedAt: row.publishedAt,
                  id: row.entityId,
                  readableId: row.entityReadableId,
                  name: row.name,
                  description: row.description,
                  entityType: entityTypeFrom(row.entityType),
                  isSelf: Boolean(row.selfEntityId),
                }
              : null,
        })),
      };
    });
  }

  nextPending(input: Input<'nextPending'>) {
    return this.run(() => {
      const rows = this.sql.NextPendingFaceImage`
        /* @notNull ownerId readableId */
        select asset."owner_id" as "ownerId", asset."readable_id" as "readableId"
        from "asset" asset
        left join "asset_face_analysis" analysis on analysis."asset_id" = asset."id"
          and analysis."owner_id" = asset."owner_id" and analysis."analysis_version" = ${input.analysisVersion}
        where asset."archived_at" is null
          and asset."media_type" in (select value from json_each(${JSON.stringify(input.supportedMediaTypes)}))
          and (analysis."asset_id" is null or analysis."state" = 'processing' or analysis."content_hash" <> asset."content_hash")
        order by coalesce(analysis."updated_at", asset."created_at"), asset."id" limit 1
      `;
      return rows[0] ?? null;
    });
  }

  queue(input: Input<'queue'>) {
    return this.run(() => {
      const rows = this.sql.FaceProcessingQueue`
        /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt state */
        /* @type state 'queued' | 'ready' | 'failed' | 'unsupported' */
        with images as (
          select asset."id", asset."readable_id" as "readableId", asset."name",
            asset."public_id" as "publicId", asset."published_at" as "publishedAt", asset."media_type" as "mediaType",
            asset."extension", asset."size_bytes" as "sizeBytes", asset."created_at" as "createdAt", asset."updated_at" as "updatedAt",
            case when asset."media_type" not in (select value from json_each(${JSON.stringify(input.supportedMediaTypes)})) then 'unsupported'
              when analysis."asset_id" is null or analysis."state" = 'processing' or analysis."content_hash" <> asset."content_hash" then 'queued'
              else analysis."state" end as "state", analysis."error"
          from "asset" asset left join "asset_face_analysis" analysis
            on analysis."asset_id" = asset."id" and analysis."owner_id" = asset."owner_id" and analysis."analysis_version" = ${input.analysisVersion}
          where asset."owner_id" = ${input.ownerId} and asset."archived_at" is null and asset."media_type" like 'image/%'
        )
        select * from images where ${input.filter} = 'all' or "state" = ${input.filter === 'pending' ? 'queued' : input.filter}
        order by "createdAt", "readableId" limit ${input.limit} offset ${input.offset}
      `;
      const totals = this.sql.FaceProcessingCounts`
        /* @notNull state count */
        /* @type state 'queued' | 'ready' | 'failed' | 'unsupported' */
        select case when asset."media_type" not in (select value from json_each(${JSON.stringify(input.supportedMediaTypes)})) then 'unsupported'
          when analysis."asset_id" is null or analysis."state" = 'processing' or analysis."content_hash" <> asset."content_hash" then 'queued'
          else analysis."state" end as "state", count(*) as "count"
        from "asset" asset left join "asset_face_analysis" analysis
          on analysis."asset_id" = asset."id" and analysis."owner_id" = asset."owner_id" and analysis."analysis_version" = ${input.analysisVersion}
        where asset."owner_id" = ${input.ownerId} and asset."archived_at" is null and asset."media_type" like 'image/%'
        group by 1
      `;
      const counts = { queued: 0, ready: 0, failed: 0, unsupported: 0 };
      for (const row of totals) {
        counts[row.state] = Number(row.count);
      }
      return {
        counts,
        items: rows.map(({ state, error, ...asset }) => ({
          asset: { ...asset, sizeBytes: Number(asset.sizeBytes) },
          state,
          error: state === 'failed' ? error : null,
        })),
      };
    });
  }

  retryFailed(input: Input<'retryFailed'>) {
    return this.run(() => {
      this.sql`
        update "asset_face_analysis" set "state" = 'processing', "error" = null, "updated_at" = ${input.updatedAt}
        where "owner_id" = ${input.ownerId} and "analysis_version" = ${input.analysisVersion} and "state" = 'failed'
          and exists(select 1 from "asset" where "id" = "asset_face_analysis"."asset_id" and "owner_id" = ${input.ownerId} and "archived_at" is null)
      `;
    });
  }

  observations(input: Input<'observations'>) {
    return this.run(() => readObservations({ database: this.database, ...input }));
  }

  enqueue(input: Input<'enqueue'>) {
    return this.run(() => {
      this.sql`
        insert into "asset_face_analysis" ("asset_id", "owner_id", "analysis_version", "content_hash", "attempt_id", "state", "error", "updated_at")
        values (${input.assetId}, ${input.ownerId}, ${input.analysisVersion}, ${input.contentHash}, ${input.attemptId}, 'processing', null, ${input.updatedAt})
        on conflict ("asset_id", "analysis_version") do update set "content_hash" = excluded."content_hash", "attempt_id" = excluded."attempt_id", "state" = 'processing', "error" = null, "updated_at" = excluded."updated_at"
        where "asset_face_analysis"."state" <> 'processing'
      `;
    });
  }

  begin(input: Input<'begin'>) {
    return this.run(() => {
      this.sql`
        insert into "asset_face_analysis" ("asset_id", "owner_id", "analysis_version", "content_hash", "attempt_id", "state", "error", "updated_at")
        values (${input.assetId}, ${input.ownerId}, ${input.analysisVersion}, ${input.contentHash}, ${input.attemptId}, 'processing', null, ${input.updatedAt})
        on conflict ("asset_id", "analysis_version") do update set "content_hash" = excluded."content_hash", "attempt_id" = excluded."attempt_id", "state" = 'processing', "error" = null, "updated_at" = excluded."updated_at"
      `;
    });
  }

  complete(input: Input<'complete'>) {
    return this.run(() =>
      this.sql.begin(() => {
        const live = this.sql.CheckFaceAnalysisAttempt`
        /* @notNull assetId */
        select asset."id" as "assetId" from "asset" asset join "asset_face_analysis" analysis
          on analysis."asset_id" = asset."id" and analysis."owner_id" = asset."owner_id"
        where asset."owner_id" = ${input.ownerId} and asset."id" = ${input.assetId} and asset."archived_at" is null
          and asset."content_hash" = ${input.contentHash} and analysis."analysis_version" = ${input.analysisVersion}
          and analysis."attempt_id" = ${input.attemptId} and analysis."state" = 'processing'
      `;
        if (!live[0]) {
          throw new Error('This analysis was superseded. Retry the image.');
        }
        const previous = readObservations({
          database: this.database,
          ownerId: input.ownerId,
          assetId: input.assetId,
        });
        const next = reconcileFaces({ previous, extracted: input.faces });
        this
          .sql`update "asset_face" set "current" = 0 where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}`;
        // A changed reference invalidates scores computed from its previous pixels, even in the same embedding space.
        this.sql`
          delete from "asset_depicts_entity" where "owner_id" = ${input.ownerId} and "source" = 'detected'
          and "face_id" in (
            select "id" from "asset_face" where "owner_id" = ${input.ownerId}
            and ("asset_id" = ${input.assetId} or "matched_reference_face_id" in (
              select "id" from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}
            ))
          )
        `;
        this.sql`
          update "asset_face" set "matched_entity_id" = null, "matched_reference_face_id" = null,
            "match_similarity" = null, "match_threshold" = null
          where "owner_id" = ${input.ownerId} and ("asset_id" = ${input.assetId} or "matched_reference_face_id" in (
            select "id" from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}
          ))
        `;
        for (const face of next) {
          this.sql`
          insert into "asset_face" ("id", "readable_id", "owner_id", "asset_id", "box", "crop_key", "detection_score", "analysis_version", "current", "needs_review", "embedding_space", "embedding_revision", "embedding", "embedding_dimensions")
          values (${face.id}, ${face.readableId}, ${input.ownerId}, ${input.assetId}, ${JSON.stringify(face.box)}, ${face.cropKey}, ${face.detectionScore}, ${input.analysisVersion}, 1, ${Number(face.needsReview)}, ${face.embeddingSpace}, ${face.embeddingRevision}, ${vectorBytes(face.embedding)}, ${face.embedding.length})
          on conflict ("id") do update set "crop_key" = excluded."crop_key", "box" = excluded."box", "detection_score" = excluded."detection_score", "analysis_version" = excluded."analysis_version", "current" = 1, "needs_review" = excluded."needs_review",
            "embedding_space" = excluded."embedding_space", "embedding_revision" = excluded."embedding_revision", "embedding" = excluded."embedding", "embedding_dimensions" = excluded."embedding_dimensions"
        `;
        }
        this
          .sql`delete from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "current" = 0
        and "annotation_decision" is null
        and not exists(select 1 from "entity_face_reference" where "face_id" = "asset_face"."id")`;
        this
          .sql`update "asset_face_analysis" set "state" = 'ready', "error" = null, "updated_at" = ${input.updatedAt}
        where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "attempt_id" = ${input.attemptId}`;
        this.replaceLinks(input);
        const kept = new Set(next.map((face) => face.id));
        return previous
          .filter((face) => kept.has(face.id) || !face.protected)
          .map((face) => face.cropKey);
      }),
    );
  }

  fail(input: Input<'fail'>) {
    return this.run(() => {
      this
        .sql`update "asset_face_analysis" set "state" = 'failed', "error" = ${input.error}, "updated_at" = ${input.updatedAt}
        where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "analysis_version" = ${input.analysisVersion} and "attempt_id" = ${input.attemptId}`;
    });
  }

  private references(input: { ownerId: string; embeddingSpace: string }) {
    const rows = this.sql.ListFaceReferences`
        /* @notNull entityId faceId assetId embeddingSpace embeddingRevision vector */
        select entity."id" as "entityId", face."id" as "faceId", face."asset_id" as "assetId", face."embedding_space" as "embeddingSpace", face."embedding_revision" as "embeddingRevision", face."embedding" as "vector"
        from "entity_face_reference" reference
        join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id" and entity."entity_type" = 'person' and entity."archived_at" is null
        join "asset_face" face on face."id" = reference."face_id" and face."owner_id" = reference."owner_id" and face."asset_id" = entity."image_asset_id"
        join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id" and asset."archived_at" is null
        where reference."owner_id" = ${input.ownerId} and face."embedding_space" = ${input.embeddingSpace}
        order by entity."id"
      `;
    return rows.map(({ vector, ...row }) => ({ ...row, embedding: vectorFrom(vector) }));
  }

  enrollPortrait(input: Input<'enrollPortrait'>) {
    return this.run(() =>
      this.sql.begin(() => {
        const candidates = this.sql.FindPortraitReferenceCandidates`
          /* @notNull faceId */
          select face."id" as "faceId", face."annotation_decision" as "decision", face."annotation_entity_id" as "entityId" from "asset_face" face
          join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id" and asset."archived_at" is null
          join "entity" entity on entity."owner_id" = face."owner_id" and entity."image_asset_id" = face."asset_id"
          where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId}
            and entity."id" = ${input.entityId} and entity."entity_type" = 'person' and entity."archived_at" is null
            and face."current" = 1 and face."needs_review" = 0 and face."analysis_version" = ${input.analysisVersion}
            and not exists (
              select 1 from "entity_face_reference" reference
              join "asset_face" selected on selected."id" = reference."face_id" and selected."owner_id" = reference."owner_id"
              where reference."entity_id" = entity."id" and reference."owner_id" = entity."owner_id" and selected."asset_id" = face."asset_id"
            )
        `;
        const confirmed = candidates.filter(
          (face) => face.decision === 'person' && face.entityId === input.entityId,
        );
        const selected =
          confirmed.length === 1
            ? confirmed[0]
            : candidates.length === 1 && candidates[0]!.decision === null
              ? candidates[0]
              : null;
        if (!selected) {
          return false;
        }
        this.invalidateEntityMatches({ ownerId: input.ownerId, entityId: input.entityId });
        const retired = this.sql.RetireReassignedFaceReferences`
          /* @notNull entityId */
          delete from "entity_face_reference" where "owner_id" = ${input.ownerId}
            and "face_id" = ${selected.faceId} and "entity_id" <> ${input.entityId}
          returning "entity_id" as "entityId"
        `;
        for (const reference of retired) {
          this.invalidateEntityMatches({ ownerId: input.ownerId, entityId: reference.entityId });
        }
        this.sql`
          insert into "entity_face_reference" ("entity_id", "owner_id", "face_id") values (${input.entityId}, ${input.ownerId}, ${selected.faceId})
          on conflict ("entity_id") do update set "face_id" = excluded."face_id"
        `;
        this.sql`
          update "asset_face" set "annotation_decision" = 'person', "annotation_entity_id" = ${input.entityId}, "annotation_updated_at" = ${input.updatedAt}
          where "owner_id" = ${input.ownerId} and "id" = ${selected.faceId}
        `;
        this.replaceLinks(input);
        return true;
      }),
    );
  }

  referenceFace(input: Input<'referenceFace'>) {
    return this.run(() => {
      const rows = this.sql.ReadPersonReferenceFace`
        /* @notNull readableId */
        select face."readable_id" as "readableId" from "entity_face_reference" reference
        join "asset_face" face on face."id" = reference."face_id" and face."owner_id" = reference."owner_id"
        join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id"
        where reference."owner_id" = ${input.ownerId} and reference."entity_id" = ${input.entityId}
          and entity."image_asset_id" = face."asset_id" and entity."entity_type" = 'person' and entity."archived_at" is null
      `;
      return rows[0]?.readableId ?? null;
    });
  }

  annotate(input: Input<'annotate'>) {
    return this.run(() =>
      this.sql.begin(() => {
        const targets = this.sql.FindFaceAnnotationTarget`
        /* @notNull id name readableId */
        select face."id", face."annotation_decision" as "decision", face."annotation_entity_id" as "entityId", asset."name", asset."readable_id" as "readableId" from "asset_face" face join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id"
        where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId} and face."readable_id" = ${input.faceReadableId}
          and asset."archived_at" is null and (${input.annotation?.entityId ?? null} is null or exists(
            select 1 from "entity" where "owner_id" = ${input.ownerId} and "id" = ${input.annotation?.entityId ?? null} and "entity_type" = 'person' and "archived_at" is null))
      `;
        const face = targets[0];
        if (!face) {
          return false;
        }
        this.sql`
          update "asset_face" set "needs_review" = 0, "annotation_decision" = ${input.annotation?.decision ?? null},
            "annotation_entity_id" = ${input.annotation?.entityId ?? null}, "annotation_updated_at" = ${input.annotation ? input.updatedAt : null}
          where "owner_id" = ${input.ownerId} and "id" = ${face.id}
        `;
        // A corrected portrait must stop supplying automatic matches for its previous identity.
        const retired = this.sql.RetireCorrectedFaceReferences`
          /* @notNull entityId */
          delete from "entity_face_reference" where "owner_id" = ${input.ownerId} and "face_id" = ${face.id}
            and "entity_id" <> coalesce(${input.annotation?.entityId ?? null}, '')
          returning "entity_id" as "entityId"
        `;
        for (const reference of retired) {
          this.invalidateEntityMatches({ ownerId: input.ownerId, entityId: reference.entityId });
        }
        this.replaceLinks(input);
        recordFaceAnnotationChange({ database: this.database, input, face });
        return true;
      }),
    );
  }

  matchAsset(input: Input<'matchAsset'>) {
    return this.run(() =>
      this.sql.begin(() => {
        // Read, match and publish without yielding, so a stale snapshot can never replace newer links.
        const embeddingSpace = input.model.embeddingSpace;
        const threshold =
          this.readThreshold({ ownerId: input.ownerId, embeddingSpace }) ??
          input.model.defaultThreshold;
        const references = this.references({ ownerId: input.ownerId, embeddingSpace });
        const observations = readObservations({
          database: this.database,
          ownerId: input.ownerId,
          assetId: input.assetId,
        });
        const matches = observations
          .filter((face) => face.current && !face.protected)
          .flatMap((face) => {
            const match = matchFace({ face, references, threshold });
            return match ? [match] : [];
          });
        this.sql`
          update "asset_face" set "matched_entity_id" = null, "matched_reference_face_id" = null,
            "match_similarity" = null, "match_threshold" = null
          where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "annotation_decision" is null
        `;
        for (const match of matches) {
          this.sql`
            update "asset_face" as face
            set "matched_entity_id" = reference."entity_id", "matched_reference_face_id" = reference."face_id",
              "match_similarity" = ${match.similarity}, "match_threshold" = ${threshold}
            from "entity_face_reference" reference
            join "asset_face" reference_face on reference_face."id" = reference."face_id" and reference_face."owner_id" = reference."owner_id"
            join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id"
            join "asset" portrait on portrait."id" = reference_face."asset_id" and portrait."owner_id" = reference_face."owner_id"
            where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId} and face."id" = ${match.faceId}
              and face."current" = 1 and face."needs_review" = 0 and face."annotation_decision" is null
              and face."embedding_space" = ${embeddingSpace} and face."embedding_revision" = ${match.faceEmbeddingRevision}
              and reference."owner_id" = face."owner_id" and reference."entity_id" = ${match.entityId} and reference."face_id" = ${match.referenceFaceId}
              and reference_face."embedding_space" = ${embeddingSpace} and reference_face."embedding_revision" = ${match.referenceEmbeddingRevision}
              and entity."image_asset_id" = reference_face."asset_id" and entity."entity_type" = 'person' and entity."archived_at" is null
              and portrait."archived_at" is null
              and exists (select 1 from "asset" where "id" = face."asset_id" and "owner_id" = face."owner_id" and "archived_at" is null)
          `;
        }
        this.replaceLinks(input);
      }),
    );
  }

  private invalidateEntityMatches(input: { ownerId: string; entityId: string }) {
    this.sql`
      delete from "asset_depicts_entity" where "owner_id" = ${input.ownerId}
        and "entity_id" = ${input.entityId} and "source" = 'detected'
    `;
    this.sql`
      update "asset_face" set "matched_entity_id" = null, "matched_reference_face_id" = null,
        "match_similarity" = null, "match_threshold" = null
      where "owner_id" = ${input.ownerId} and "matched_entity_id" = ${input.entityId}
    `;
  }

  /** Publish links in the same transaction as their face assignments, like other resource links. */
  private replaceLinks(input: FaceAssetInput) {
    this
      .sql`delete from "asset_depicts_entity" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}`;
    this.sql`
      insert into "asset_depicts_entity" ("face_id", "owner_id", "asset_id", "entity_id", "source")
      select face."id", face."owner_id", face."asset_id",
        coalesce(face."annotation_entity_id", face."matched_entity_id"),
        case when face."annotation_decision" is null then 'detected' else 'confirmed' end
      from "asset_face" face
      left join "entity_face_reference" reference on reference."entity_id" = face."matched_entity_id"
        and reference."owner_id" = face."owner_id" and reference."face_id" = face."matched_reference_face_id"
      left join "asset_face" reference_face on reference_face."id" = reference."face_id" and reference_face."owner_id" = reference."owner_id"
      left join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id"
      where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId}
        and (face."annotation_decision" = 'person' or (
          face."annotation_decision" is null and face."current" = 1 and face."needs_review" = 0
          and reference_face."asset_id" = entity."image_asset_id"
          and reference_face."embedding_space" = face."embedding_space"
          and entity."archived_at" is null and entity."entity_type" = 'person'
        ))
    `;
  }

  threshold(input: Input<'threshold'>) {
    return this.run(
      () =>
        this.readThreshold({
          ownerId: input.ownerId,
          embeddingSpace: input.model.embeddingSpace,
        }) ?? input.model.defaultThreshold,
    );
  }

  private readThreshold(input: { ownerId: string; embeddingSpace: string }): number | null {
    const rows = this.sql.ReadFaceThreshold`
      /* @notNull threshold */
      select "threshold" from "face_recognition_setting" where "owner_id" = ${input.ownerId} and "embedding_space" = ${input.embeddingSpace}
    `;
    return rows[0] ? Number(rows[0].threshold) : null;
  }

  setThreshold(input: Input<'setThreshold'>) {
    return this.run(() => {
      this
        .sql`insert into "face_recognition_setting" ("owner_id", "embedding_space", "threshold") values (${input.ownerId}, ${input.embeddingSpace}, ${input.threshold})
        on conflict ("owner_id", "embedding_space") do update set "threshold" = excluded."threshold"`;
    });
  }

  assetBatch(input: Input<'assetBatch'>) {
    return this.run(
      () => this.sql.FaceAssetBatch`
      /* @notNull id readableId mediaType */
      select "id", "readable_id" as "readableId", "media_type" as "mediaType" from "asset"
      where "owner_id" = ${input.ownerId} and "archived_at" is null and "media_type" like 'image/%'
        and (${input.after} is null or "readable_id" > ${input.after}) order by "readable_id" limit ${input.limit}
    `,
    );
  }

  images(input: Input<'images'>) {
    return this.run(() => {
      const rows = this.sql.ListPersonImages`
        /* @notNull id readableId name mediaType sizeBytes createdAt updatedAt */
        with person as (
          select "id", "owner_id", "image_asset_id" from "entity"
          where "owner_id" = ${input.ownerId} and "readable_id" = ${input.entityReadableId}
            and "archived_at" is null and "entity_type" = 'person'
        ), image_ids as (
          select "image_asset_id" as "id" from person where "image_asset_id" is not null
          union
          select link."asset_id" as "id" from "asset_depicts_entity" link
          join person on person."id" = link."entity_id" and person."owner_id" = link."owner_id"
        )
        select asset."id", asset."readable_id" as "readableId", asset."name",
          asset."public_id" as "publicId", asset."published_at" as "publishedAt",
          asset."media_type" as "mediaType", asset."extension", asset."size_bytes" as "sizeBytes", asset."created_at" as "createdAt", asset."updated_at" as "updatedAt"
        from image_ids join "asset" asset on asset."id" = image_ids."id"
        where asset."owner_id" = ${input.ownerId} and asset."archived_at" is null
        order by asset."created_at" desc, asset."readable_id" limit ${input.limit} offset ${input.offset}
      `;
      return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
    });
  }
}
