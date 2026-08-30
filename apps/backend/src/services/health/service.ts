import type { HealthRepositoryContract } from '#repositories/health/repository.ts';
import { Service } from '#services/service.ts';

export class HealthService extends Service {
  private readonly healthRepo: HealthRepositoryContract;

  constructor(healthRepo: HealthRepositoryContract) {
    super();
    this.healthRepo = healthRepo;
  }

  async check(): Promise<{ status: 'ok'; uptime: number }> {
    this.logger.info('pinging the database');
    await this.healthRepo.ping();
    return { status: 'ok', uptime: process.uptime() };
  }
}

export type HealthServiceContract = Pick<HealthService, 'check'>;
