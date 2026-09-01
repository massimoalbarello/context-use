import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import {
  OWNER_USER_ID,
  type OwnerRegistrationPersistenceState,
} from '#lib/auth/owner-registration.ts';
import type { Queries } from '#queries.gen.ts';

export interface OwnerRegistrationRepositoryContract {
  state(): Promise<OwnerRegistrationPersistenceState>;
}

export class OwnerRegistrationRepository implements OwnerRegistrationRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async state(): Promise<OwnerRegistrationPersistenceState> {
    const rows = await this.sql.ReadOwnerRegistrationState`
      /* @type ownerExists number */
      /* @type passkeyExists number */
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
