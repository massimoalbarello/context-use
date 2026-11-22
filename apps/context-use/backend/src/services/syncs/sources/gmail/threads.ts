import type { SyncContext, SyncStep } from '@context-use/open-sync/definition';
import { z } from 'zod';
import {
  checkpointSchema,
  excluded,
  GMAIL_SYNC_LABEL,
  GMAIL_SYNC_LOOKBACK_MONTHS,
  historyId,
  nativeId,
  PAGE_SIZE,
  threadSchema,
  threadSummarySchema,
} from './models.ts';
import { threadRecord } from './record.ts';
import {
  GmailLabelMissing,
  GmailMailboxChanged,
  GmailNotFound,
  GmailResyncRequired,
  request,
} from './request.ts';

const reference = z.object({ threadId: nativeId });
const changes = z.object({
  messages: z.array(reference).default([]),
  messagesAdded: z.array(z.object({ message: reference })).default([]),
  messagesDeleted: z.array(z.object({ message: reference })).default([]),
  labelsAdded: z.array(z.object({ message: reference })).default([]),
  labelsRemoved: z.array(z.object({ message: reference })).default([]),
});
const historyPage = z.object({
  history: z.array(changes).default([]),
  historyId,
  nextPageToken: nativeId.optional(),
});

export async function step(context: SyncContext): Promise<SyncStep> {
  const checkpoint = checkpointSchema.parse(context.checkpoint);
  const profile = z
    .object({ emailAddress: z.email(), historyId })
    .parse(await request({ context, path: '/users/me/profile' }));
  const account = profile.emailAddress.toLowerCase();
  if (checkpoint.account && checkpoint.account !== account) {
    throw new GmailMailboxChanged();
  }
  const directory = z
    .object({ labels: z.array(z.object({ id: nativeId, name: nativeId })) })
    .parse(await request({ context, path: '/users/me/labels' }));
  const labelId = directory.labels.find((label) => label.name === GMAIL_SYNC_LABEL)?.id;
  if (!labelId) {
    throw new GmailLabelMissing();
  }
  if (checkpoint.labelId && checkpoint.labelId !== labelId) {
    throw new GmailResyncRequired();
  }
  if (checkpoint.phase === 'initial') {
    // Commit the pre-backfill boundary before listing any native pages.
    return {
      records: [],
      checkpoint: {
        ...checkpoint,
        account,
        labelId,
        phase: 'backfill',
        historyId: profile.historyId,
      },
      complete: false,
    };
  }
  if (!checkpoint.account || !checkpoint.labelId || !checkpoint.historyId) {
    throw new Error('Incomplete Gmail checkpoint.');
  }
  const page =
    checkpoint.phase === 'backfill'
      ? await backfill({ context, checkpoint })
      : await history({ context, checkpoint });
  const records = await readRecords({ context, ids: page.ids, account, labelId });
  return { records, checkpoint: page.checkpoint, complete: page.complete };
}

function qualifies(input: {
  messages: z.infer<typeof threadSummarySchema>['messages'];
  labelId: string;
  cutoff: number;
}) {
  return (
    input.messages.some((message) => message.labelIds.includes(input.labelId)) &&
    input.messages.some((message) => Number(message.internalDate) >= input.cutoff)
  );
}

async function readRecords(input: {
  context: SyncContext;
  ids: string[];
  account: string;
  labelId: string;
}) {
  const cutoff = Temporal.Now.zonedDateTimeISO('UTC').subtract({
    months: GMAIL_SYNC_LOOKBACK_MONTHS,
  }).epochMilliseconds;
  const records = [];
  for (const id of input.ids) {
    let thread: z.infer<typeof threadSchema>;
    try {
      const path = `/users/me/threads/${encodeURIComponent(id)}`;
      const summary = threadSummarySchema.parse(
        await request({
          context: input.context,
          path,
          query: { fields: 'id,messages(labelIds,internalDate)' },
        }),
      );
      if (summary.id !== id) {
        throw new Error('Gmail returned a different conversation.');
      }
      const messages = summary.messages.filter((message) => !excluded(message.labelIds));
      if (!qualifies({ messages, labelId: input.labelId, cutoff })) {
        continue;
      }
      thread = threadSchema.parse(
        await request({ context: input.context, path, query: { format: 'full' } }),
      );
      if (thread.id !== id || thread.messages.some((message) => message.threadId !== id)) {
        throw new Error('Gmail returned a different conversation.');
      }
    } catch (error) {
      // Unavailable source threads retain their last imported copy. Attachment failures must escape.
      if (error instanceof GmailNotFound) {
        continue;
      }
      throw error;
    }
    thread.messages = thread.messages.filter((message) => !excluded(message.labelIds));
    if (qualifies({ messages: thread.messages, labelId: input.labelId, cutoff })) {
      records.push(await threadRecord({ context: input.context, account: input.account, thread }));
    }
  }
  return records;
}

type Position = z.infer<typeof checkpointSchema>;
async function backfill(input: { context: SyncContext; checkpoint: Position }) {
  const { checkpoint, context } = input;
  const page = z
    .object({
      threads: z.array(z.object({ id: nativeId })).default([]),
      nextPageToken: nativeId.optional(),
    })
    .parse(
      await request({
        context,
        path: '/users/me/threads',
        query: {
          // Commit each backfilled thread before fetching the next thread and its attachments.
          maxResults: 1,
          // A recent reply and the label can be on different messages. Check dates on the thread.
          labelIds: checkpoint.labelId!,
          includeSpamTrash: false,
          ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
        },
      }),
    );
  const pageToken = continuation({ next: page.nextPageToken, previous: checkpoint.pageToken });
  return {
    ids: [...new Set(page.threads.map((item) => item.id))],
    checkpoint: { ...checkpoint, pageToken, phase: pageToken ? 'backfill' : 'history' },
    complete: false,
  };
}
async function history(input: { context: SyncContext; checkpoint: Position }) {
  const { checkpoint, context } = input;
  const page = historyPage.parse(
    await request({
      context,
      path: '/users/me/history',
      query: {
        maxResults: PAGE_SIZE,
        startHistoryId: checkpoint.historyId!,
        ...(checkpoint.pageToken ? { pageToken: checkpoint.pageToken } : {}),
      },
    }),
  );
  if (BigInt(page.historyId) < BigInt(checkpoint.historyId!)) {
    throw new Error('Gmail history moved backwards.');
  }
  const pageToken = continuation({ next: page.nextPageToken, previous: checkpoint.pageToken });
  const ids = [
    ...new Set(
      page.history.flatMap((event) =>
        [
          ...event.messages,
          ...event.messagesAdded.map((entry) => entry.message),
          ...event.messagesDeleted.map((entry) => entry.message),
          ...event.labelsAdded.map((entry) => entry.message),
          ...event.labelsRemoved.map((entry) => entry.message),
        ].map((message) => message.threadId),
      ),
    ),
  ];
  return {
    ids,
    checkpoint: {
      ...checkpoint,
      pageToken,
      historyId: pageToken ? checkpoint.historyId : page.historyId,
    },
    complete: !pageToken,
  };
}
function continuation(input: { next?: string; previous: string | null }) {
  if (input.next && input.next === input.previous) {
    throw new Error('Gmail repeated its page cursor.');
  }
  return input.next ?? null;
}
