import { type TypedSQL, withTypes } from '@ilbertt/bun-sqlgen';
import type { SQL } from 'bun';
import type { Queries } from '#queries.gen.ts';

export interface HealthRepositoryContract {
  ping(): Promise<void>;
}

export class HealthRepository implements HealthRepositoryContract {
  private readonly sql: TypedSQL<Queries>;

  constructor(sql: SQL) {
    this.sql = withTypes<Queries>(sql);
  }

  async ping(): Promise<void> {
    await this.sql.PingDatabase`
      /* @type value number */
      select 1 as "value"
    `;
  }
}
