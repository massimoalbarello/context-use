import type { Database, SQLQueryBindings } from 'bun:sqlite';
import type { Queries } from '#queries.gen.ts';

// biome-ignore lint/complexity/useMaxParams: JavaScript fixes the tagged-template argument positions.
type QueryTag<Row> = (strings: TemplateStringsArray, ...values: SQLQueryBindings[]) => Row[];
export type FaceSqlite = QueryTag<unknown> & {
  readonly [Name in keyof Queries]: QueryTag<Queries[Name]>;
} & {
  begin<T>(operation: () => T): T;
};

/** Keep generated query types, but never yield while holding SQLite's write lock. */
export function withTypes(database: Database): FaceSqlite {
  // biome-ignore lint/complexity/useMaxParams: JavaScript fixes the tagged-template argument positions.
  const execute: QueryTag<unknown> = (strings, ...values) => {
    const statement = database.prepare(strings.join('?'));
    try {
      return statement.all(...values);
    } finally {
      statement.finalize();
    }
  };
  const tagged = new Proxy(execute, {
    // biome-ignore lint/complexity/useMaxParams: Proxy.get receives its target and property separately.
    get(_target, property) {
      if (property === 'begin') {
        return <T>(operation: () => T): T => database.transaction(operation).immediate();
      }
      return execute;
    },
  }) as FaceSqlite;
  return tagged;
}
