import type { FaceBox, FaceMatch, FaceObservation, FaceReference } from './model.ts';

const MINIMUM_OVERLAP = 0.7;
const CONFLICT_OVERLAP = 0.2;

export function overlap({ a, b }: { a: FaceBox; b: FaceBox }): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const intersection =
    Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) *
    Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  return intersection / (aw * ah + bw * bh - intersection);
}

export function reconcileFaces({
  previous,
  extracted,
}: {
  previous: Array<FaceObservation & { protected: boolean }>;
  extracted: FaceObservation[];
}): FaceObservation[] {
  return extracted.map((face) => {
    const candidates = previous.filter(
      (old) => overlap({ a: old.box, b: face.box }) >= MINIMUM_OVERLAP,
    );
    const old = candidates[0];
    const unique =
      old &&
      candidates.length === 1 &&
      extracted.filter((other) => overlap({ a: old.box, b: other.box }) >= MINIMUM_OVERLAP)
        .length === 1;
    if (unique) {
      return {
        ...face,
        id: old.id,
        readableId: old.readableId,
        box: old.protected ? old.box : face.box,
      };
    }
    return {
      ...face,
      needsReview: previous.some(
        (old) => old.protected && overlap({ a: old.box, b: face.box }) > CONFLICT_OVERLAP,
      ),
    };
  });
}

export function cosineSimilarity({
  a,
  b,
}: {
  a: readonly number[];
  b: readonly number[];
}): number | null {
  if (a.length !== b.length || a.length === 0) {
    return null;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index]! * b[index]!;
    normA += a[index]! ** 2;
    normB += b[index]! ** 2;
  }
  if (normA === 0 || normB === 0 || !Number.isFinite(dot + normA + normB)) {
    return null;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

export function matchFace({
  face,
  references,
  threshold,
}: {
  face: FaceObservation;
  references: FaceReference[];
  threshold: number;
}): FaceMatch | null {
  if (face.needsReview) {
    return null;
  }
  let best: FaceMatch | null = null;
  let tied = false;
  for (const reference of references) {
    if (face.embeddingSpace !== reference.embeddingSpace) {
      continue;
    }
    const score = cosineSimilarity({ a: face.embedding, b: reference.embedding });
    if (score === null || score < threshold) {
      continue;
    }
    if (!best || score > best.similarity) {
      best = {
        faceId: face.id,
        referenceFaceId: reference.faceId,
        faceEmbeddingRevision: face.embeddingRevision,
        referenceEmbeddingRevision: reference.embeddingRevision,
        entityId: reference.entityId,
        similarity: score,
      };
      tied = false;
    } else if (score === best.similarity && reference.entityId !== best.entityId) {
      tied = true;
    }
  }
  return tied ? null : best;
}
