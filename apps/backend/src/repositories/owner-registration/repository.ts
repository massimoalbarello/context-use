import {
  OWNER_USER_ID,
  type OwnerRegistrationPersistenceState,
} from '#lib/auth/owner-registration.ts';
import { Repository } from '#repositories/repository.ts';

export interface OwnerRegistrationRepositoryContract {
  state(): Promise<OwnerRegistrationPersistenceState>;
}

type OwnerRegistrationRow = {
  ownerExists: number;
  passkeyExists: number;
};

export class OwnerRegistrationRepository
  extends Repository
  implements OwnerRegistrationRepositoryContract
{
  async state(): Promise<OwnerRegistrationPersistenceState> {
    const rows = await this.sql<OwnerRegistrationRow[]>`
      select
        exists(select 1 from "auth_user" where "id" = ${OWNER_USER_ID}) as "ownerExists",
        exists(select 1 from "auth_passkey" where "userId" = ${OWNER_USER_ID}) as "passkeyExists"
    `;
    const row = rows[0];
    return {
      ownerExists: Boolean(row?.ownerExists),
      passkeyExists: Boolean(row?.passkeyExists),
    };
  }
}
