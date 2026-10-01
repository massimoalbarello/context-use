import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import { checkpointSchema, directorySchema, identitySchema, pageSize } from './models.ts';
import { eventPageSchema, eventRecord } from './records.ts';
import { request } from './request.ts';

type Checkpoint = ReturnType<typeof checkpointSchema.parse>;
export async function step(context: SyncContext): Promise<SyncStep> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const account = identitySchema.parse(await request({ context, path: '/calendars/primary' })).id;
  if (checkpoint.account && checkpoint.account !== account) {
    throw new Error('Google Calendar account changed. Create a new sync for this account.');
  }
  checkpoint.account = account;
  if (!checkpoint.calendarId) {
    await discoverCalendar({ context, checkpoint });
    if (!checkpoint.calendarId) {
      return { records: [], checkpoint, complete: !checkpoint.directoryPageToken };
    }
  }
  const calendarId = checkpoint.calendarId;
  const syncToken = checkpoint.syncTokens[calendarId];
  const page = eventPageSchema.parse(
    await request({
      context,
      path: `/calendars/${encodeURIComponent(calendarId)}/events`,
      // No time window, updatedMin, orderBy, or instance expansion: identical
      // sync-compatible parameters across backfill, delta pages, and later polls.
      query: {
        maxResults: pageSize,
        showDeleted: true,
        singleEvents: false,
        ...(syncToken ? { syncToken } : {}),
        ...(checkpoint.eventPageToken ? { pageToken: checkpoint.eventPageToken } : {}),
      },
    }),
  );
  if (page.nextPageToken) {
    // Empty intermediate pages are valid in Google's change feed.
    if (page.nextSyncToken || page.nextPageToken === checkpoint.eventPageToken) {
      throw new Error('Google Calendar returned invalid event pagination.');
    }
    checkpoint.eventPageToken = page.nextPageToken;
  } else {
    if (!page.nextSyncToken) {
      throw new Error('Google Calendar omitted the completed sync token.');
    }
    checkpoint.syncTokens[calendarId] = page.nextSyncToken;
    checkpoint.calendarId = null;
    checkpoint.eventPageToken = null;
  }
  return {
    records: page.items.map((event) => eventRecord({ event, calendarId, timeZone: page.timeZone })),
    checkpoint,
    complete: !checkpoint.calendarId && !checkpoint.directoryPageToken,
  };
}

async function discoverCalendar({
  context,
  checkpoint,
}: {
  context: SyncContext;
  checkpoint: Checkpoint;
}) {
  const page = directorySchema.parse(
    await request({
      context,
      path: '/users/me/calendarList',
      query: {
        maxResults: 1,
        minAccessRole: 'reader',
        showHidden: true,
        ...(checkpoint.directoryPageToken ? { pageToken: checkpoint.directoryPageToken } : {}),
      },
    }),
  );
  if (
    page.items.length > 1 ||
    (page.nextPageToken && page.nextPageToken === checkpoint.directoryPageToken)
  ) {
    throw new Error('Google Calendar returned invalid directory pagination.');
  }
  checkpoint.calendarId = page.items[0]?.id ?? null;
  checkpoint.directoryPageToken = page.nextPageToken ?? null;
}
