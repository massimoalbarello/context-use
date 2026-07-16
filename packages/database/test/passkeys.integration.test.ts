import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = adminUrl ? describe : describe.skip;

describeDatabase("immutable passkey schema", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  test("enforces one passkey per owner", async () => {
    const userId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query(
        `INSERT INTO "user"(id,name,email,"emailVerified")
         VALUES ($1,'Passkey owner',$2,true)`,
        [userId, `${userId}@example.com`],
      );
      await admin.query(
        `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp")
         VALUES ($1,'public-key',$2,$3,0,'singleDevice',false)`,
        [randomUUID(), userId, `credential-${randomUUID()}`],
      );

      let errorCode: string | undefined;
      let constraint: string | undefined;
      try {
        await admin.query(
          `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp")
           VALUES ($1,'second-public-key',$2,$3,0,'singleDevice',false)`,
          [randomUUID(), userId, `credential-${randomUUID()}`],
        );
      } catch (error) {
        errorCode = error instanceof Error && "code" in error ? String(error.code) : undefined;
        constraint = error instanceof Error && "constraint" in error ? String(error.constraint) : undefined;
      }
      expect(errorCode).toBe("23505");
      expect(constraint).toBe("passkey_userId_unique");
    } finally {
      await admin.query("ROLLBACK");
    }
  });
});
