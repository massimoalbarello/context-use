import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

const RECORD_MIGRATION = new URL(
  '../../../src/db/migrations/0006_add_api_keys_and_records.sql',
  import.meta.url,
);
const OCCURRENCE_MIGRATION = new URL(
  '../../../src/db/migrations/0015_add_record_occurrence.sql',
  import.meta.url,
);
const CONTENT_HASH_LENGTH = 64;

test('adding occurrence metadata preserves historical records without inferring their occurrence', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(await Bun.file(RECORD_MIGRATION).text());
    database.run(
      `insert into "record"
        ("owner_id", "readable_id", "provider", "kind", "source_id", "title",
         "source_created_at", "source_updated_at", "storage_key", "content_hash",
         "size_bytes", "created_at", "updated_at")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'owner',
        'calendar-event',
        'googlecalendar',
        'event',
        '["calendar","event"]',
        'Planning',
        '2020-01-02T03:04:05.000Z',
        '2026-10-01T08:00:00.000Z',
        'owner/records/calendar-event/content.md',
        'a'.repeat(CONTENT_HASH_LENGTH),
        10,
        '2026-10-02T08:00:00.000Z',
        '2026-10-02T08:00:00.000Z',
      ],
    );
    const before = database.query<Record<string, unknown>, []>('select * from "record"').get();
    database.exec(await Bun.file(OCCURRENCE_MIGRATION).text());
    expect(database.prepare('select * from "record"').all()).toEqual([
      { ...before, source_occurred_at: null },
    ]);
  } finally {
    database.close();
  }
});
