import type { ProviderOperations, ProviderResponse } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { unused } from './fixture.ts';

export const created = '2020-01-02T03:04:05Z';
export function event(id: string): JsonObject {
  return {
    id,
    status: 'confirmed',
    summary: `Event ${id}`,
    created,
    updated: created,
    start: { dateTime: '2026-10-01T09:00:00+01:00', timeZone: 'Europe/London' },
    end: { dateTime: '2026-10-01T10:00:00+01:00', timeZone: 'Europe/London' },
    attendees: [{ email: 'guest@example.com', displayName: 'Guest', responseStatus: 'accepted' }],
    organizer: { email: 'owner@example.com' },
    location: 'Meeting room',
    description: 'Discuss the plan',
    htmlLink: 'https://calendar.google.com/event?eid=one',
    recurrence: ['RRULE:FREQ=WEEKLY'],
  };
}
export function calendarFixture() {
  const requests: Array<{ path: string; query: JsonObject }> = [];
  let account = 'owner@example.com';
  let delta: JsonObject[] = [];
  let intercept:
    | ((input: { path: string; query: JsonObject }) => Promise<ProviderResponse> | undefined)
    | undefined;
  const reply = (body: JsonObject): Promise<ProviderResponse> =>
    Promise.resolve({ status: 200, headers: {}, body });
  function readEvents(query: JsonObject) {
    if (query.syncToken) {
      if (!query.pageToken) {
        return reply({ items: delta, nextPageToken: 'delta-final', timeZone: 'Europe/London' });
      }
      return reply({ items: [], nextSyncToken: 'a-delta', timeZone: 'Europe/London' });
    }
    if (!query.pageToken) {
      return reply({
        items: [event('one')],
        nextPageToken: 'a-empty',
        timeZone: 'Europe/London',
      });
    }
    if (query.pageToken === 'a-empty') {
      return reply({ items: [], nextPageToken: 'a-final', timeZone: 'Europe/London' });
    }
    return reply({ items: [event('two')], nextSyncToken: 'a-full', timeZone: 'Europe/London' });
  }
  function readOtherCalendar(query: JsonObject) {
    return reply({
      items: query.syncToken
        ? []
        : [
            {
              ...event('one'),
              start: { date: '2026-10-01' },
              end: { date: '2026-10-02' },
              recurrence: [],
            },
          ],
      nextSyncToken: 'b-full',
      timeZone: 'Europe/London',
    });
  }
  const provider: ProviderOperations = {
    action: unused,
    post: unused,
    get({ path, query = {} }) {
      requests.push({ path, query });
      const injected = intercept?.({ path, query });
      if (injected) {
        return injected;
      }
      if (path === '/calendars/primary') {
        return reply({ id: account });
      }
      if (path === '/users/me/calendarList') {
        return reply(
          query.pageToken
            ? { items: [{ id: 'b' }] }
            : { items: [{ id: 'a' }], nextPageToken: 'directory-b' },
        );
      }
      if (path === '/calendars/a/events') {
        return readEvents(query);
      }
      if (path === '/calendars/b/events') {
        return readOtherCalendar(query);
      }
      return unused();
    },
  };
  return {
    requests,
    provider,
    reply,
    set account(value: string) {
      account = value;
    },
    set delta(value: JsonObject[]) {
      delta = value;
    },
    set intercept(value: typeof intercept) {
      intercept = value;
    },
    get eventRequests() {
      return requests.filter(({ path }) => path.endsWith('/events'));
    },
  };
}
