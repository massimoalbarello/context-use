import { ownerRegistrationStatus } from '#backend/lib/auth/owner-registration.ts';
import type { OwnerRegistrationRepositoryContract } from '#backend/repositories/owner-registration/repository.ts';

export class OwnerRegistrationService {
  private readonly registration: OwnerRegistrationRepositoryContract;

  constructor(registration: OwnerRegistrationRepositoryContract) {
    this.registration = registration;
  }

  async status(): Promise<{ ownerRegistered: boolean }> {
    return ownerRegistrationStatus(await this.registration.state());
  }
}

export type OwnerRegistrationServiceContract = Pick<OwnerRegistrationService, 'status'>;
