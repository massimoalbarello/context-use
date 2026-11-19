import {
  SourceHttpError,
  type SyncContext,
  type SyncStep,
} from '@context-use/open-sync/definition';
import type { JsonObject } from '@context-use/open-sync/json';
import type { SyncRecord } from '@context-use/open-sync/record';
import { checkpointSchema, noteSchema, responseSchema } from './models.ts';
import { granolaRecord } from './record.ts';

// Bound each step's detail requests and retry cost; the API allows up to 30 notes per page.
const pageSize = 10;

export async function stepGranolaMeetings(context: SyncContext): Promise<SyncStep> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const listing = responseSchema.parse(
    await get({
      context,
      path: '/v1/notes',
      query: {
        page_size: pageSize,
        ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}),
      },
    }),
  );
  if (listing.hasMore && (!listing.cursor || listing.cursor === checkpoint.cursor)) {
    throw new Error('Granola returned invalid note pagination.');
  }
  const ids = listing.notes.map((note) => note.id);
  if (new Set(ids).size !== ids.length || ids.length > pageSize) {
    throw new Error('Granola returned an invalid note page.');
  }
  const records: SyncRecord[] = [];
  for (const note of listing.notes) {
    if (note.deleted_at) {
      continue;
    }
    const detail = noteSchema.parse(
      await get({ context, path: `/v1/notes/${encodeURIComponent(note.id)}` }),
    );
    if (detail.id !== note.id) {
      throw new Error('Granola returned a different note identity.');
    }
    if (!detail.deleted_at) {
      records.push(granolaRecord(detail));
    }
  }
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error('Granola returned duplicate meeting identities.');
  }
  context.signal.throwIfAborted();
  return {
    records,
    checkpoint: { cursor: listing.hasMore ? listing.cursor : null },
    complete: !listing.hasMore,
  };
}

async function get({
  context,
  path,
  query,
}: {
  context: SyncContext;
  path: string;
  query?: JsonObject;
}) {
  context.signal.throwIfAborted();
  const response = await context.provider.get({ path, query });
  context.signal.throwIfAborted();
  const ok = 200;
  if (response.status !== ok) {
    throw new SourceHttpError(response);
  }
  return response.body;
}
