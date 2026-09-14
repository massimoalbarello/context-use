import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteDatabase } from '#backend/db/client.ts';
import { runMigrations } from '#backend/db/migrate.ts';
import {
  InvalidHypermediaNeighborhoodsError,
  InvalidHypermediaPagesError,
  MAX_HYPERMEDIA_GRAPH_ANCHORS,
  MAX_HYPERMEDIA_NEIGHBOR_LIMIT,
  MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES,
  MAX_HYPERMEDIA_PAGE_LIMIT,
} from '#backend/models/hypermedia-graph/model.ts';
import { HypermediaGraphRepository } from '#backend/repositories/hypermedia-graph/repository.ts';
import { HypermediaGraphService } from '#backend/services/hypermedia-graph/service.ts';

const FRACTIONAL_LIMIT = 1.5;
const FRACTIONAL_OFFSET = 0.5;

async function withGraphService(run: (graph: HypermediaGraphService) => Promise<void>) {
  const dataFolder = await mkdtemp(join(tmpdir(), 'context-use-graph-service-test-'));
  const database = await createSqliteDatabase({ dataFolder });
  try {
    await runMigrations({ db: database });
    await run(new HypermediaGraphService({ graph: new HypermediaGraphRepository(database) }));
  } finally {
    await database.close();
    await rm(dataFolder, { recursive: true, force: true });
  }
}

test('neighborhood bounds apply to service callers without HTTP validation', async () => {
  await withGraphService(async (graph) => {
    const input = {
      ownerId: 'owner',
      anchors: [{ anchor: { readableId: 'topic' } }],
      limit: MAX_HYPERMEDIA_NEIGHBOR_LIMIT,
    };
    for (const limit of [
      0,
      -1,
      FRACTIONAL_LIMIT,
      Number.NaN,
      Infinity,
      MAX_HYPERMEDIA_NEIGHBOR_LIMIT + 1,
    ]) {
      expect(() => graph.neighborhoods({ ...input, limit })).toThrow(
        InvalidHypermediaNeighborhoodsError,
      );
    }
    const anchors = [...Array(MAX_HYPERMEDIA_GRAPH_ANCHORS + 1).keys()].map((index) => ({
      anchor: { readableId: `topic-${index}` },
    }));
    for (const invalid of [[], [...input.anchors, ...input.anchors], anchors]) {
      expect(() => graph.neighborhoods({ ...input, anchors: invalid })).toThrow(
        InvalidHypermediaNeighborhoodsError,
      );
    }
    const allowed = anchors.slice(0, MAX_HYPERMEDIA_GRAPH_ANCHORS);
    const result = await graph.neighborhoods({ ...input, anchors: allowed });
    expect(result.neighborhoods).toEqual(
      allowed.map(({ anchor }) => ({ anchor, available: false, neighbors: [], nextPage: null })),
    );
  });
});

test('page bounds apply to service callers without HTTP validation', async () => {
  await withGraphService(async (graph) => {
    const input = {
      ownerId: 'owner',
      visibleEntities: [],
      limit: MAX_HYPERMEDIA_PAGE_LIMIT,
      offset: 0,
    };
    for (const limit of [
      0,
      -1,
      FRACTIONAL_LIMIT,
      Number.NaN,
      Infinity,
      MAX_HYPERMEDIA_PAGE_LIMIT + 1,
    ]) {
      expect(() => graph.pages({ ...input, limit })).toThrow(InvalidHypermediaPagesError);
    }
    for (const offset of [
      -1,
      FRACTIONAL_OFFSET,
      Number.NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => graph.pages({ ...input, offset })).toThrow(InvalidHypermediaPagesError);
    }
    const visibleEntities = [...Array(MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES + 1).keys()].map(
      (index) => ({
        readableId: `topic-${index}`,
      }),
    );
    expect(() => graph.pages({ ...input, visibleEntities })).toThrow(InvalidHypermediaPagesError);
    for (const focus of [[], visibleEntities.slice(0, MAX_HYPERMEDIA_PAGE_FOCUS_ENTITIES)]) {
      expect(await graph.pages({ ...input, visibleEntities: focus })).toEqual({
        pages: [],
        nextOffset: null,
        entityReferencesTruncated: false,
      });
    }
  });
});
