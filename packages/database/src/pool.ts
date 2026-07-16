import { Pool, type PoolConfig } from "pg";

export function createPool(connectionString: string, overrides: PoolConfig = {}): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "context-use",
    ...overrides,
  });
}
