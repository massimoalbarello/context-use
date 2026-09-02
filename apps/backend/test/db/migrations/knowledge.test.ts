import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import {
  MAX_TEMPORAL_COVERAGE_LENGTH,
  temporalBoundsFrom,
} from '#models/knowledge-pages/temporal-coverage.ts';

const KNOWLEDGE_MIGRATION = new URL(
  '../../../src/db/migrations/0001_knowledge.sql',
  import.meta.url,
);
const AUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0000_better_auth_schema.sql',
  import.meta.url,
);
const ENTITY_ARCHIVE_MIGRATION = new URL(
  '../../../src/db/migrations/0002_add_entity_archived_at.sql',
  import.meta.url,
);
const PAGE_ARCHIVE_MIGRATION = new URL(
  '../../../src/db/migrations/0003_add_knowledge_page_archived_at.sql',
  import.meta.url,
);
const ARCHIVE_INVARIANT_MIGRATION = new URL(
  '../../../src/db/migrations/0004_prevent_self_entity_archiving.sql',
  import.meta.url,
);
const ASSET_MIGRATION = new URL('../../../src/db/migrations/0005_add_assets.sql', import.meta.url);
const OAUTH_MIGRATION = new URL(
  '../../../src/db/migrations/0006_add_oauth_provider.sql',
  import.meta.url,
);
const MCP_CLIENT_AUTHORIZATION_MIGRATION = new URL(
  '../../../src/db/migrations/0007_add_mcp_client_authorizations.sql',
  import.meta.url,
);
const CONTENT_HASH_LENGTH = 64;

test('knowledge revisions require a lowercase hexadecimal SHA-256 hash', async () => {
  const database = new Database(':memory:');

  try {
    database.exec(await Bun.file(KNOWLEDGE_MIGRATION).text());

    expect(() =>
      database.run(
        `insert into "knowledge_page_revision"
          ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
           "storage_key", "size_bytes", "content_hash", "author_kind", "author_name",
           "created_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'revision-id',
          'page-id',
          'owner-id',
          1,
          'Title',
          'Excerpt',
          'storage-key',
          1,
          `a${'g'.repeat(CONTENT_HASH_LENGTH - 1)}`,
          'owner',
          'Owner',
          '2026-01-01T00:00:00.000Z',
        ],
      ),
    ).toThrow();
  } finally {
    database.close();
  }
});

test('temporal coverage is revision-owned, nullable, and bounded', async () => {
  const database = new Database(':memory:');

  try {
    database.exec(await Bun.file(KNOWLEDGE_MIGRATION).text());
    database.run(
      `insert into "knowledge_page_revision"
        ("id", "page_id", "owner_id", "revision_number", "title", "excerpt",
         "storage_key", "size_bytes", "content_hash", "author_kind", "author_name", "created_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'revision-id',
        'page-id',
        'owner-id',
        1,
        'Title',
        'Excerpt',
        'storage-key',
        1,
        'a'.repeat(CONTENT_HASH_LENGTH),
        'owner',
        'Owner',
        'created',
      ],
    );

    expect(
      database
        .query(
          `select "temporal_coverage", "temporal_start_ms", "temporal_end_exclusive_ms"
           from "knowledge_page_revision" where "id" = ?`,
        )
        .get('revision-id'),
    ).toEqual({
      temporal_coverage: null,
      temporal_start_ms: null,
      temporal_end_exclusive_ms: null,
    });
    const bounds = temporalBoundsFrom('2025-03/2025-08');
    database.run(
      `update "knowledge_page_revision"
       set "temporal_coverage" = ?, "temporal_start_ms" = ?, "temporal_end_exclusive_ms" = ?
       where "id" = ?`,
      ['2025-03/2025-08', bounds.start, bounds.end, 'revision-id'],
    );
    expect(() =>
      database.run(`update "knowledge_page_revision" set "temporal_coverage" = ? where "id" = ?`, [
        '',
        'revision-id',
      ]),
    ).toThrow();
    expect(() =>
      database.run(`update "knowledge_page_revision" set "temporal_coverage" = ? where "id" = ?`, [
        '2'.repeat(MAX_TEMPORAL_COVERAGE_LENGTH + 1),
        'revision-id',
      ]),
    ).toThrow();
  } finally {
    database.close();
  }
});

test('archive schema preserves existing resources and rejects archiving the self entity', async () => {
  const database = new Database(':memory:');

  try {
    database.exec(await Bun.file(AUTH_MIGRATION).text());
    database.exec(await Bun.file(KNOWLEDGE_MIGRATION).text());
    database.run(
      `insert into "auth_user"
        ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
       values (?, ?, ?, ?, ?, ?)`,
      ['owner-id', 'Owner', 'owner@example.com', 1, 'created', 'updated'],
    );
    database.run(
      `insert into "entity"
        ("id", "owner_id", "readable_id", "name", "description", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?)`,
      ['self-id', 'owner-id', 'owner', 'Owner', 'Self entity', 'created', 'updated'],
    );
    database.run(`insert into "knowledge_profile" ("owner_id", "self_entity_id") values (?, ?)`, [
      'owner-id',
      'self-id',
    ]);

    database.exec(await Bun.file(ENTITY_ARCHIVE_MIGRATION).text());
    database.exec(await Bun.file(PAGE_ARCHIVE_MIGRATION).text());
    database.exec(await Bun.file(ARCHIVE_INVARIANT_MIGRATION).text());

    expect(
      database.query(`select "archived_at" from "entity" where "id" = 'self-id'`).get(),
    ).toEqual({ archived_at: null });
    expect(() =>
      database.run(`update "entity" set "archived_at" = ? where "id" = ?`, [
        '2026-01-01T00:00:00.000Z',
        'self-id',
      ]),
    ).toThrow('self entity cannot be archived');
  } finally {
    database.close();
  }
});

test('entity image columns preserve ownership and exclusive assignment', async () => {
  const database = new Database(':memory:');
  database.exec('pragma foreign_keys = on');

  try {
    database.exec(await Bun.file(AUTH_MIGRATION).text());
    database.exec(await Bun.file(KNOWLEDGE_MIGRATION).text());
    database.exec(await Bun.file(ASSET_MIGRATION).text());
    database.exec(await Bun.file(OAUTH_MIGRATION).text());
    database.exec(await Bun.file(MCP_CLIENT_AUTHORIZATION_MIGRATION).text());
    for (const ownerId of ['owner-a', 'owner-b']) {
      database.run(
        `insert into "auth_user"
          ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
         values (?, ?, ?, ?, ?, ?)`,
        [ownerId, ownerId, `${ownerId}@example.com`, 1, 'created', 'updated'],
      );
    }
    database.run(
      `insert into "asset"
        ("id", "owner_id", "readable_id", "name", "media_type", "extension", "size_bytes",
         "content_hash", "storage_key", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'portrait-id',
        'owner-a',
        'portrait',
        'Portrait',
        'image/png',
        'png',
        1,
        'a'.repeat(CONTENT_HASH_LENGTH),
        'owner-a/assets/portrait',
        'created',
        'updated',
      ],
    );
    database.run(
      `insert into "entity"
        ("id", "owner_id", "readable_id", "name", "description", "image_asset_id",
         "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'entity-a',
        'owner-a',
        'entity-a',
        'Entity A',
        'First entity',
        'portrait-id',
        'created',
        'updated',
      ],
    );

    expect(() =>
      database.run(
        `insert into "entity"
          ("id", "owner_id", "readable_id", "name", "description", "image_asset_id",
           "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'entity-b',
          'owner-a',
          'entity-b',
          'Entity B',
          'Second entity',
          'portrait-id',
          'created',
          'updated',
        ],
      ),
    ).toThrow();
    expect(() =>
      database.run(
        `insert into "entity"
          ("id", "owner_id", "readable_id", "name", "description", "image_asset_id",
           "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'other-entity',
          'owner-b',
          'other-entity',
          'Other entity',
          'Different owner',
          'portrait-id',
          'created',
          'updated',
        ],
      ),
    ).toThrow();

    expect(() => database.run(`delete from "auth_user" where "id" = ?`, ['owner-a'])).not.toThrow();
    expect(database.query(`select "id" from "entity"`).all()).toEqual([]);
    expect(database.query(`select "id" from "asset"`).all()).toEqual([]);
  } finally {
    database.close();
  }
});
