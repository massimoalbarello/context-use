import { afterAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { AssetRepository } from "../src/index.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("hierarchical asset metadata", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const assets = new AssetRepository(pool);
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) await pool.query("DELETE FROM assets WHERE id=$1", [id]);
    await pool.end();
  });

  test("creates and lists an asset at its requested knowledge path", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await assets.create({
      currentPath: `tests/${suffix}/site-photo`,
      filename: "site-photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: 123,
      contentHash: "a".repeat(64),
    });
    createdIds.push(created.id);

    expect(created.current_path).toBe(`tests/${suffix}/site-photo`);
    expect((await assets.get(created.id))?.current_path).toBe(created.current_path);
    expect((await assets.list()).some((asset) => asset.id === created.id && asset.current_path === created.current_path)).toBe(true);
  });
});
