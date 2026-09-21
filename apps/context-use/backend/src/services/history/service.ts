import type { HistoryRepositoryContract } from '#backend/repositories/history/repository.ts';

export class HistoryService {
  constructor(private readonly history: HistoryRepositoryContract) {}
  list(input: Parameters<HistoryRepositoryContract['list']>[0]) {
    return this.history.list(input);
  }
}
export type HistoryServiceContract = Pick<HistoryService, 'list'>;
