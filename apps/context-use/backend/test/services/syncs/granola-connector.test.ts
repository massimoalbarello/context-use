import { expect, test } from 'bun:test';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import { stepGranolaMeetings } from '#backend/services/syncs/sources/granola/meetings/step.ts';

// Exercise the patched transitive dependency actually loaded by Open Sync.
const connector = import.meta.resolve(
  '@oomol-lab/open-connector',
  import.meta.resolve('@context-use/open-sync'),
);
const {
  granolaMcpActionHandlers,
}: {
  granolaMcpActionHandlers: Record<
    string,
    (
      input: JsonObject,
      context: { accessToken: string; fetcher: typeof fetch; signal: AbortSignal },
    ) => Promise<JsonObject>
  >;
} = await import(new URL('../providers/granola/runtime-mcp.js', connector).href);

const id = 'abcdef00-0000-4000-8000-000000000001';
const occurredAt = '2026-11-18T18:37:16+00:00';
const markdown = '    indented code\n\nKeep **Markdown** & code `a < b`.';
const emptySummary =
  '<summary status="empty">No summary. This note is empty: it has no notes and no AI summary has been generated for it.</summary>';

function meetings(input: { timestamp?: string; summary?: string; count?: number } = {}) {
  return `<meetings_data count="${input.count ?? 1}"><meeting id="${id}" title="Planning" ${input.timestamp ?? `meeting_at="${occurredAt}" created_at="2026-11-17T12:00:00Z" updated_at="2026-11-19T10:00:00Z"`}><known_participants>Ada</known_participants>${input.summary ?? `<summary><![CDATA[${markdown}]]></summary>`}</meeting></meetings_data>`;
}

function context(input: { detail: string; listing?: string }): SyncContext {
  const unexpected = () => {
    throw new Error('Unexpected operation');
  };
  const signal = new AbortController().signal;
  const fetcher = (async (...args: Parameters<typeof fetch>) => {
    const http = new Request(...args);
    expect(http.url).toBe('https://mcp.granola.ai/mcp');
    expect(http.headers.get('authorization')).toBe('Bearer synthetic-token');
    if (http.method === 'GET') {
      return new Response(null, { status: 405 });
    }
    const request = await http.json();
    if (request.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    let result: JsonObject;
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'Granola fixture', version: '1' },
      };
    } else {
      expect(request.method).toBe('tools/call');
      expect(['list_meetings', 'get_meetings']).toContain(request.params.name);
      result = {
        content: [
          {
            type: 'text',
            text:
              request.params.name === 'list_meetings'
                ? (input.listing ?? meetings({ summary: '' }))
                : input.detail,
          },
        ],
      };
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  }) as typeof fetch;
  return {
    config: {},
    checkpoint: {},
    syncId: 'sync',
    signal,
    provider: {
      get: unexpected,
      post: unexpected,
      action: ({ id: action, input }) =>
        granolaMcpActionHandlers[action.replace('granola.', '')]!(input, {
          accessToken: 'synthetic-token',
          fetcher,
          signal,
        }),
    },
    assets: { capture: unexpected, unavailable: unexpected },
  };
}

test.each([
  { summary: `<summary><![CDATA[${markdown}]]></summary>`, expected: markdown },
  { summary: emptySummary, expected: '' },
  { summary: '<summary status="empty" />', expected: '' },
])('Granola sync accepts current timestamps and summaries: $summary', async (input) => {
  const result = await stepGranolaMeetings(context({ detail: meetings(input) }));
  expect(result.complete).toBe(true);
  expect(result.records).toHaveLength(1);
  expect(result.records[0]).toMatchObject({
    id,
    data: { date: occurredAt, sourceOccurredAt: occurredAt, notes: input.expected },
  });
});

test.each(['<summary />', emptySummary])(
  'Granola accepts legacy dates with %s',
  async (summary) => {
    const result = await stepGranolaMeetings(
      context({
        detail: meetings({ timestamp: 'date="Nov 18, 2026 6:37 PM GMT"', summary }),
        listing: meetings({ timestamp: 'date="Nov 18, 2026 6:37 PM GMT"', summary: '' }),
      }),
    );
    expect(result.records[0]).toMatchObject({
      id,
      data: { date: 'Nov 18, 2026 6:37 PM GMT', sourceOccurredAt: null, notes: '' },
    });
  },
);

test.each([
  { summary: '' },
  { summary: '<summary status="not_included">Access denied</summary>' },
  { summary: '<summary><error>Unavailable</error></summary>' },
  { timestamp: 'created_at="2026-11-18T18:37:16Z"' },
  { count: 2 },
])('Granola rejects incomplete details without publishing records: %j', async (input) => {
  await expect(stepGranolaMeetings(context({ detail: meetings(input) }))).rejects.toThrow();
});
