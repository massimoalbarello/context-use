import {
  type OwnerRegistrationRepositoryContract,
  ownerRegistrationStatus,
} from '#lib/auth/owner-registration.ts';
import { Service } from '#services/service.ts';

export class OwnerRegistrationService extends Service {
  private readonly registration: OwnerRegistrationRepositoryContract;

  constructor(registration: OwnerRegistrationRepositoryContract) {
    super();
    this.registration = registration;
  }

  async status(): Promise<{ ownerRegistered: boolean }> {
    return ownerRegistrationStatus(await this.registration.state());
  }
}

export type OwnerRegistrationServiceContract = Pick<OwnerRegistrationService, 'status'>;
