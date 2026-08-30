import { Repository } from '#repositories/repository.ts';

export interface HealthRepositoryContract {
  ping(): Promise<void>;
}

export class HealthRepository extends Repository implements HealthRepositoryContract {
  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }
}
