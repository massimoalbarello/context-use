import type { Database } from 'bun:sqlite';
import { reconcileFaces } from '#models/faces/matching.ts';
import type { FaceBox, FaceDecision } from '#models/faces/model.ts';
import { entityTypeFrom } from '#views/entities/entity-view.ts';
import type { FaceAssetInput, FacesRepositoryContract, StoredFace } from './contract.ts';
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
      face."current", face."needs_review" as "needsReview", embedding."embedding_space" as "embeddingSpace", embedding."revision" as "embeddingRevision", embedding."vector",
      (exists(select 1 from "face_annotation" where "face_id" = face."id" and "owner_id" = face."owner_id")
       or exists(select 1 from "entity_face_reference" where "face_id" = face."id" and "owner_id" = face."owner_id")) as "protected"
    from "asset_face" face join "face_embedding" embedding on embedding."face_id" = face."id" and embedding."owner_id" = face."owner_id"
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
        select face."readable_id" as "readableId", face."box", face."current", face."needs_review" as "needsReview",
          annotation."decision", entity."id" as "entityId", entity."readable_id" as "entityReadableId",
          entity."name", entity."description", entity."entity_type" as "entityType", profile."self_entity_id" as "selfEntityId", match."similarity"
        from "asset_face" face
        left join "face_annotation" annotation on annotation."face_id" = face."id" and annotation."owner_id" = face."owner_id"
        left join "asset_depicts_entity" link on link."face_id" = face."id" and link."owner_id" = face."owner_id"
        left join "entity" entity on entity."id" = link."entity_id" and entity."owner_id" = link."owner_id"
        left join "knowledge_profile" profile on profile."self_entity_id" = entity."id" and profile."owner_id" = entity."owner_id"
        left join "face_match" match on match."face_id" = face."id" and match."owner_id" = face."owner_id" and annotation."face_id" is null and entity."id" is not null
        where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId}
          and (face."current" = 1 or annotation."face_id" is not null)
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

  observations(input: Input<'observations'>) {
    return this.run(() => readObservations({ database: this.database, ...input }));
  }

  begin(input: Input<'begin'>) {
    return this.run(() => {
      this.sql`
        insert into "asset_face_analysis" ("asset_id", "owner_id", "analysis_version", "content_hash", "attempt_id", "state", "error", "updated_at")
        values (${input.assetId}, ${input.ownerId}, ${input.analysisVersion}, ${input.contentHash}, ${input.attemptId}, 'processing', null, ${input.updatedAt})
        on conflict ("asset_id", "analysis_version") do update set "attempt_id" = excluded."attempt_id", "state" = 'processing', "error" = null, "updated_at" = excluded."updated_at"
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
        this
          .sql`delete from "face_match" where "owner_id" = ${input.ownerId} and ("face_id" in (select "id" from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}) or "reference_face_id" in (select "id" from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId}))`;
        for (const face of next) {
          this.sql`
          insert into "asset_face" ("id", "readable_id", "owner_id", "asset_id", "box", "crop_key", "detection_score", "analysis_version", "current", "needs_review")
          values (${face.id}, ${face.readableId}, ${input.ownerId}, ${input.assetId}, ${JSON.stringify(face.box)}, ${face.cropKey}, ${face.detectionScore}, ${input.analysisVersion}, 1, ${Number(face.needsReview)})
          on conflict ("id") do update set "crop_key" = excluded."crop_key", "box" = excluded."box", "detection_score" = excluded."detection_score", "analysis_version" = excluded."analysis_version", "current" = 1, "needs_review" = excluded."needs_review"
        `;
          this.sql`
          insert into "face_embedding" ("face_id", "owner_id", "embedding_space", "revision", "vector", "dimensions")
          values (${face.id}, ${input.ownerId}, ${face.embeddingSpace}, ${face.embeddingRevision}, ${vectorBytes(face.embedding)}, ${face.embedding.length})
          on conflict ("face_id") do update set "embedding_space" = excluded."embedding_space", "revision" = excluded."revision", "vector" = excluded."vector", "dimensions" = excluded."dimensions"
        `;
        }
        this
          .sql`delete from "asset_face" where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "current" = 0
        and not exists(select 1 from "face_annotation" where "face_id" = "asset_face"."id")
        and not exists(select 1 from "entity_face_reference" where "face_id" = "asset_face"."id")`;
        this
          .sql`update "asset_face_analysis" set "state" = 'ready', "error" = null, "updated_at" = ${input.updatedAt}
        where "owner_id" = ${input.ownerId} and "asset_id" = ${input.assetId} and "attempt_id" = ${input.attemptId}`;
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

  references(input: Input<'references'>) {
    return this.run(() => {
      const rows = this.sql.ListFaceReferences`
        /* @notNull entityId faceId assetId embeddingSpace embeddingRevision vector */
        select entity."id" as "entityId", face."id" as "faceId", face."asset_id" as "assetId", embedding."embedding_space" as "embeddingSpace", embedding."revision" as "embeddingRevision", embedding."vector"
        from "entity_face_reference" reference
        join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id" and entity."entity_type" = 'person' and entity."archived_at" is null
        join "asset_face" face on face."id" = reference."face_id" and face."owner_id" = reference."owner_id" and face."asset_id" = entity."image_asset_id"
        join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id" and asset."archived_at" is null
        join "face_embedding" embedding on embedding."face_id" = face."id" and embedding."owner_id" = face."owner_id"
        where reference."owner_id" = ${input.ownerId} and embedding."embedding_space" = ${input.embeddingSpace}
        order by entity."id"
      `;
      return rows.map(({ vector, ...row }) => ({ ...row, embedding: vectorFrom(vector) }));
    });
  }

  selectReference(input: Input<'selectReference'>) {
    return this.run(() =>
      this.sql.begin(() => {
        const rows = this.sql.SelectPersonReferenceFace`
        /* @notNull faceId */
        select face."id" as "faceId" from "asset_face" face
        join "entity" entity on entity."owner_id" = face."owner_id" and entity."image_asset_id" = face."asset_id"
        where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId} and face."readable_id" = ${input.faceReadableId}
          and face."current" = 1 and face."needs_review" = 0 and entity."id" = ${input.entityId}
          and entity."entity_type" = 'person' and entity."archived_at" is null
      `;
        const face = rows[0];
        if (!face) {
          return false;
        }
        this
          .sql`delete from "face_match" where "owner_id" = ${input.ownerId} and "entity_id" = ${input.entityId}`;
        this
          .sql`delete from "entity_face_reference" where "owner_id" = ${input.ownerId} and "face_id" = ${face.faceId} and "entity_id" <> ${input.entityId}`;
        this
          .sql`insert into "entity_face_reference" ("entity_id", "owner_id", "face_id") values (${input.entityId}, ${input.ownerId}, ${face.faceId})
        on conflict ("entity_id") do update set "face_id" = excluded."face_id"`;
        this
          .sql`insert into "face_annotation" ("face_id", "owner_id", "decision", "entity_id", "updated_at")
        values (${face.faceId}, ${input.ownerId}, 'person', ${input.entityId}, ${input.updatedAt})
        on conflict ("face_id") do update set "decision" = 'person', "entity_id" = excluded."entity_id", "updated_at" = excluded."updated_at"`;
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
        /* @notNull id */
        select face."id" from "asset_face" face join "asset" asset on asset."id" = face."asset_id" and asset."owner_id" = face."owner_id"
        where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId} and face."readable_id" = ${input.faceReadableId}
          and asset."archived_at" is null and (${input.annotation?.entityId ?? null} is null or exists(
            select 1 from "entity" where "owner_id" = ${input.ownerId} and "id" = ${input.annotation?.entityId ?? null} and "entity_type" = 'person' and "archived_at" is null))
      `;
        const face = targets[0];
        if (!face) {
          return false;
        }
        this
          .sql`update "asset_face" set "needs_review" = 0 where "owner_id" = ${input.ownerId} and "id" = ${face.id}`;
        // Reference identity is explicit. Correcting it retires the reference instead of training from the correction.
        this
          .sql`delete from "entity_face_reference" where "owner_id" = ${input.ownerId} and "face_id" = ${face.id}
        and "entity_id" <> coalesce(${input.annotation?.entityId ?? null}, '')`;
        if (input.annotation) {
          this
            .sql`insert into "face_annotation" ("face_id", "owner_id", "decision", "entity_id", "updated_at")
          values (${face.id}, ${input.ownerId}, ${input.annotation.decision}, ${input.annotation.entityId}, ${input.updatedAt})
          on conflict ("face_id") do update set "decision" = excluded."decision", "entity_id" = excluded."entity_id", "updated_at" = excluded."updated_at"`;
        } else {
          this
            .sql`delete from "face_annotation" where "owner_id" = ${input.ownerId} and "face_id" = ${face.id}`;
        }
        return true;
      }),
    );
  }

  saveMatches(input: Input<'saveMatches'>) {
    return this.run(() =>
      this.sql.begin(() => {
        const currentThreshold = this.readThreshold(input);
        if (currentThreshold !== null && currentThreshold !== input.threshold) {
          return;
        }
        this.sql`delete from "face_match" where "owner_id" = ${input.ownerId} and "face_id" in (
        select face."id" from "asset_face" face where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId}
          and not exists(select 1 from "face_annotation" where "face_id" = face."id" and "owner_id" = face."owner_id"))`;
        for (const match of input.matches) {
          this.sql`
          insert into "face_match" ("face_id", "owner_id", "entity_id", "reference_face_id", "similarity", "threshold", "embedding_space")
          select face."id", face."owner_id", reference."entity_id", reference."face_id", ${match.similarity}, ${input.threshold}, ${input.embeddingSpace}
          from "asset_face" face
          join "face_embedding" embedding on embedding."face_id" = face."id" and embedding."owner_id" = face."owner_id" and embedding."embedding_space" = ${input.embeddingSpace} and embedding."revision" = ${match.faceEmbeddingRevision}
          join "entity_face_reference" reference on reference."owner_id" = face."owner_id" and reference."entity_id" = ${match.entityId} and reference."face_id" = ${match.referenceFaceId}
          join "asset_face" reference_face on reference_face."id" = reference."face_id" and reference_face."owner_id" = reference."owner_id"
          join "face_embedding" reference_embedding on reference_embedding."face_id" = reference_face."id" and reference_embedding."owner_id" = reference_face."owner_id" and reference_embedding."embedding_space" = ${input.embeddingSpace} and reference_embedding."revision" = ${match.referenceEmbeddingRevision}
          join "entity" entity on entity."id" = reference."entity_id" and entity."owner_id" = reference."owner_id" and entity."image_asset_id" = reference_face."asset_id" and entity."entity_type" = 'person' and entity."archived_at" is null
          where face."owner_id" = ${input.ownerId} and face."asset_id" = ${input.assetId} and face."id" = ${match.faceId} and face."current" = 1 and face."needs_review" = 0
            and not exists(select 1 from "face_annotation" where "face_id" = face."id" and "owner_id" = face."owner_id")
          on conflict ("face_id") do update set "entity_id" = excluded."entity_id", "reference_face_id" = excluded."reference_face_id", "similarity" = excluded."similarity", "threshold" = excluded."threshold", "embedding_space" = excluded."embedding_space"
        `;
        }
      }),
    );
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
        select distinct asset."id", asset."readable_id" as "readableId", asset."name", asset."media_type" as "mediaType", asset."extension", asset."size_bytes" as "sizeBytes", asset."created_at" as "createdAt", asset."updated_at" as "updatedAt"
        from "asset_depicts_entity" link join "asset" asset on asset."id" = link."asset_id" and asset."owner_id" = link."owner_id"
        join "entity" entity on entity."id" = link."entity_id" and entity."owner_id" = link."owner_id"
        where link."owner_id" = ${input.ownerId} and entity."readable_id" = ${input.entityReadableId}
        order by asset."created_at" desc, asset."readable_id" limit ${input.limit} offset ${input.offset}
      `;
      return rows.map((row) => ({ ...row, sizeBytes: Number(row.sizeBytes) }));
    });
  }
}
