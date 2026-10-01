import { expect, test } from 'bun:test';
import type { SyncContext } from '@context-use/open-sync/definition';
import { googleCalendarEvents } from '#backend/services/syncs/sources/googlecalendar/definition.ts';
import { step } from '#backend/services/syncs/sources/googlecalendar/events.ts';
import { initialCheckpoint } from '#backend/services/syncs/sources/googlecalendar/models.ts';
import { fixture, unused } from './fixture.ts';
import { calendarFixture, event } from './googlecalendar-fixture.ts';

const backfillCount = 3;
const changedCount = 5;

test('Calendar resumes native pages after restart, handles empty pages, and uses only completed per-calendar change tokens', async () => {
  const source = calendarFixture();
  const f = await fixture({ registration: googleCalendarEvents, provider: source.provider });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual({
      account: 'owner@example.com',
      syncTokens: {},
      directoryPageToken: 'directory-b',
      calendarId: 'a',
      eventPageToken: 'a-empty',
    });
    await f.restart();
    await f.finish();
    expect(source.eventRequests.map(({ path, query }) => [path, query.pageToken ?? null])).toEqual([
      ['/calendars/a/events', null],
      ['/calendars/a/events', 'a-empty'],
      ['/calendars/a/events', 'a-final'],
      ['/calendars/b/events', null],
    ]);
    expect(f.records).toHaveLength(backfillCount);
    expect(new Set(f.records.map(({ id }) => id)).size).toBe(backfillCount);
    expect(f.saved.checkpoint).toMatchObject({
      calendarId: null,
      eventPageToken: null,
      directoryPageToken: null,
      syncTokens: { a: 'a-full', b: 'b-full' },
    });
    source.requests.length = 0;
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({
      calendarId: 'a',
      eventPageToken: 'delta-final',
      syncTokens: { a: 'a-full' },
    });
    await f.restart();
    await f.finish();
    expect(f.records).toHaveLength(backfillCount);
    expect(
      source.eventRequests.map(({ query }) => [query.syncToken, query.pageToken ?? null]),
    ).toEqual([
      ['a-full', null],
      ['a-full', 'delta-final'],
      ['b-full', null],
    ]);
    source.delta = [
      { ...event('one'), summary: 'Edited event' },
      { id: 'two', status: 'cancelled' },
    ];
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(changedCount);
    expect(f.records.at(-1)).toMatchObject({
      operation: 'upsert',
      id: '["a","two"]',
      data: { status: 'cancelled', start: null, end: null },
    });
    expect(source.eventRequests.every(({ query }) => query.syncToken)).toBe(true);
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(changedCount);
  } finally {
    await f.close();
  }
});

test('Calendar commits no partial page on malformed events and restarts from the same cursor', async () => {
  const source = calendarFixture();
  const f = await fixture({ registration: googleCalendarEvents, provider: source.provider });
  try {
    await f.engine.tick();
    const checkpoint = f.saved.checkpoint;
    source.intercept = ({ query, path }) =>
      path.endsWith('/events') && query.pageToken === 'a-empty'
        ? source.reply({
            items: [event('three'), { id: 'broken', status: 'confirmed' }],
            nextPageToken: 'a-final',
          })
        : undefined;
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(checkpoint);
    expect(f.saved.errorCode).toBe('execution_failed');
    source.intercept = undefined;
    await f.restart();
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(backfillCount);
    expect(f.records.some(({ id }) => id === '["a","three"]')).toBe(false);
  } finally {
    await f.close();
  }
});

test('Calendar pauses on expired change tokens without replaying the archive or advancing state', async () => {
  const source = calendarFixture();
  const f = await fixture({ registration: googleCalendarEvents, provider: source.provider });
  try {
    await f.finish();
    const checkpoint = f.saved.checkpoint;
    source.requests.length = 0;
    source.intercept = ({ path }) =>
      path.endsWith('/events')
        ? Promise.reject({
            code: 'connector_request_failed',
            diagnostics: { service: 'googlecalendar', operation: path, providerStatus: 410 },
          })
        : undefined;
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(checkpoint);
    expect(f.saved.errorCode).toBe('googlecalendar_checkpoint_invalid_resync_required');
    expect(source.eventRequests).toHaveLength(1);
    expect(source.eventRequests[0]?.query.syncToken).toBe('a-full');
  } finally {
    await f.close();
  }
});

test('Calendar rejects an account switch before fetching event or directory data', async () => {
  const source = calendarFixture();
  const f = await fixture({ registration: googleCalendarEvents, provider: source.provider });
  try {
    await f.engine.tick();
    const checkpoint = f.saved.checkpoint;
    source.account = 'other@example.com';
    source.requests.length = 0;
    await f.engine.tick();
    expect(source.requests.map(({ path }) => path)).toEqual(['/calendars/primary']);
    expect(f.saved.checkpoint).toEqual(checkpoint);
  } finally {
    await f.close();
  }
});

function context(source: ReturnType<typeof calendarFixture>): SyncContext {
  return {
    config: {},
    checkpoint: initialCheckpoint,
    syncId: 'test',
    signal: new AbortController().signal,
    provider: source.provider,
    assets: {
      capture: unused,
      unavailable: () => {
        throw new Error('Unexpected asset');
      },
    },
  };
}

test('Calendar rejects missing completion tokens and honours cancellation before any I/O', async () => {
  const source = calendarFixture();
  source.intercept = ({ path }) =>
    path.endsWith('/events') ? source.reply({ items: [event('one')] }) : undefined;
  await expect(step(context(source))).rejects.toThrow('completed sync token');
  const controller = new AbortController();
  controller.abort();
  source.requests.length = 0;
  await expect(step({ ...context(source), signal: controller.signal })).rejects.toThrow();
  expect(source.requests).toEqual([]);
});
