import type { SQL } from 'bun';
import type { Storage } from '#backend/lib/storage/storage.ts';
import { HypermediaRetrievalRepository } from '#backend/repositories/hypermedia-retrieval/repository.ts';
import { HypermediaRetrievalService } from '#backend/services/hypermedia-retrieval/service.ts';

export function createTestHypermediaRetrievalService({
  database,
  storage,
}: {
  database: SQL;
  storage: Storage;
}) {
  return new HypermediaRetrievalService({
    retrieval: new HypermediaRetrievalRepository({ database, storage }),
  });
}
