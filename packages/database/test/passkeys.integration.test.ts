import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = adminUrl ? describe : describe.skip;

describeDatabase("owner passkey schema", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  test("allows multiple passkeys but never removal of the final credential", async () => {
    const userId = "context-use-owner";
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ($1,'Passkey owner',$2,true)`,
        [userId, "owner@example.com"],
      );
      await admin.query(
        `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp")
         VALUES ($1,'public-key',$2,$3,0,'singleDevice',false)`,
        [randomUUID(), userId, `credential-${randomUUID()}`],
      );

      const secondId = randomUUID();
      await admin.query(
        `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp")
         VALUES ($1,'second-public-key',$2,$3,0,'singleDevice',false)`,
        [secondId, userId, `credential-${randomUUID()}`],
      );
      expect((await admin.query(
        `SELECT count(*)::int AS count FROM passkey WHERE "userId"=$1`,
        [userId],
      )).rows[0]?.count).toBe(2);

      await admin.query("SELECT remove_owner_passkey($1,$2)", [userId, secondId]);
      await expect(admin.query(
        "SELECT remove_owner_passkey($1,(SELECT id FROM passkey WHERE \"userId\"=$1))",
        [userId],
      )).rejects.toMatchObject({ code: "22023" });
    } finally {
      await admin.query("ROLLBACK");
    }
  });

  test("rejects any second owner identity", async () => {
    await expect(admin.query(
      `INSERT INTO "user"(id,name,email,"emailVerified") VALUES ('another-owner','Other','other@example.com',true)`,
    )).rejects.toMatchObject({ code: "23514", constraint: "user_single_owner_check" });
  });
});
