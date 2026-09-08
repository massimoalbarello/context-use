import type { SQL } from 'bun';
import { HypermediaRetrievalRepository } from '#repositories/hypermedia-retrieval/repository.ts';
import { HypermediaRetrievalService } from '#services/hypermedia-retrieval/service.ts';

export function createTestHypermediaRetrievalService(database: SQL) {
  return new HypermediaRetrievalService(new HypermediaRetrievalRepository(database));
}
