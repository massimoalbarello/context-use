import type { SQL } from 'bun';
import type { Storage } from '#lib/storage/storage.ts';
import { HypermediaGraphRepository } from '#repositories/hypermedia-graph/repository.ts';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { HypermediaGraphService } from '#services/hypermedia-graph/service.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';

export function createTestHypermediaRetrievalService({
  database,
  storage,
}: {
  database: SQL;
  storage: Storage;
}) {
  return new HypermediaRetrievalService({
    retrieval: new HypermediaRetrievalRepository({ database, storage }),
    graph: new HypermediaGraphService({ graph: new HypermediaGraphRepository(database) }),
  });
}
