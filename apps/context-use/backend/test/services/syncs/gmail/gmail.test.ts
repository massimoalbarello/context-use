import { expect, test } from 'bun:test';
import { gmailThreads } from '#backend/services/syncs/sources/gmail/definition.ts';
import { fixture } from '../engine-fixture.ts';
import {
  account,
  attachedMessage,
  completedHistory,
  gmailFixture,
  initialHistory,
  message,
} from './fixture.ts';

test('Gmail commits its boundary before backfill, resumes native pages, then polls only mailbox-wide history', async () => {
  const source = gmailFixture();
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({
      account,
      phase: 'backfill',
      historyId: initialHistory,
      pageToken: null,
    });
    expect(source.requests.some(({ path }) => path === '/users/me/threads')).toBe(false);
    await f.engine.tick();
    expect(f.saved.checkpoint.pageToken).toBe('1');
    await f.restart();
    await f.finish();
    expect(
      source.requests.filter(({ path }) => path === '/users/me/threads').map(({ query }) => query),
    ).toEqual([
      { maxResults: 10, includeSpamTrash: false, labelIds: ['Label_context'] },
      { maxResults: 10, includeSpamTrash: false, labelIds: ['Label_context'], pageToken: '1' },
      { maxResults: 10, includeSpamTrash: false, labelIds: ['Label_context'], pageToken: '2' },
    ]);
    expect(
      source.requests.find(({ path }) => path === '/users/me/history')?.query.startHistoryId,
    ).toBe(initialHistory);
    expect(f.records).toHaveLength(1);
    expect(f.saved.checkpoint).toMatchObject({
      phase: 'history',
      pageToken: null,
      historyId: completedHistory,
    });
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(source.requests.some(({ path }) => path === '/users/me/threads')).toBe(false);
    expect(source.requests.find(({ path }) => path === '/users/me/history')?.query).toEqual({
      maxResults: 10,
      startHistoryId: completedHistory,
    });
  } finally {
    await f.close();
  }
});

test('a failed nested attachment commits no partial conversation or cursor and succeeds after retry', async () => {
  const source = gmailFixture();
  source.thread = { ...source.thread, messages: [attachedMessage()] };
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.engine.tick();
    const checkpoint = f.saved.checkpoint;
    source.downloadError = new Error('Temporary attachment failure');
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(checkpoint);
    expect(f.records).toHaveLength(0);
    expect(f.saved.errorCode).toBe('execution_failed');
    source.downloadError = undefined;
    await f.restart();
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
    expect(f.deliveries[0]!.assets).toHaveLength(2);
    expect(source.downloads.every((id) => id === 'invoice-bytes')).toBe(true);
  } finally {
    await f.close();
  }
});

test('Gmail catches unlabelled replies and drains all history pages before advancing its durable boundary', async () => {
  const source = gmailFixture();
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    source.thread = {
      ...source.thread,
      historyId: '9007199254740993020',
      messages: [
        message({ id: 'message-one', text: 'Amount due: £120.50' }),
        message({
          id: 'reply',
          text: 'Paid in full.\n\nOn Nov 1, Alex wrote:\n> Amount due: £120.50',
          labels: [],
          date: '2026-11-02T10:00:00Z',
        }),
      ],
    };
    source.historyPages = [
      {
        history: [{ messagesAdded: [{ message: { threadId: 'thread-one' } }] }],
        historyId: '9007199254740993020',
        nextPageToken: '1',
      },
      { historyId: '9007199254740993030' },
    ];
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toMatchObject({ historyId: completedHistory, pageToken: '1' });
    await f.restart();
    await f.finish();
    expect(f.saved.checkpoint.historyId).toBe('9007199254740993030');
    expect(f.records).toHaveLength(2);
    const record = f.records.at(-1)!;
    if (record.operation !== 'upsert') {
      throw new Error('Expected conversation');
    }
    expect(record.content?.body).toContain('Paid in full.');
    expect(record.content?.body.match(/Amount due/g)).toHaveLength(1);
    expect(record.updatedAt).toBe('2026-11-02T10:00:00.000Z');
  } finally {
    await f.close();
  }
});

test('Gmail preserves unlabelled, missing and excluded threads without loading their bodies or assets', async () => {
  const source = gmailFixture();
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    source.requests.length = 0;
    source.thread = {
      ...source.thread,
      messages: [message({ id: 'message-one', text: 'Excluded', labels: [] })],
    };
    source.historyPages = [
      {
        history: [{ labelsRemoved: [{ message: { threadId: 'thread-one' } }] }],
        historyId: '9007199254740993020',
      },
    ];
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
    expect(source.requests.filter(({ query }) => query.format === 'full')).toHaveLength(0);
    source.thread = {
      ...source.thread,
      messages: [message({ id: 'message-one', text: 'Spam', labels: ['Label_context', 'SPAM'] })],
    };
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
    source.intercept = ({ path }) =>
      path.endsWith('/thread-one')
        ? Promise.resolve({ status: 404, headers: {}, body: {} })
        : undefined;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
  } finally {
    await f.close();
  }
});

const HISTORY_NOT_FOUND = 404;
const HISTORY_BAD_REQUEST = 400;
test.each([HISTORY_NOT_FOUND, HISTORY_BAD_REQUEST])(
  'Gmail history rejection %s requires explicit recovery and never restarts the archive',
  async (status) => {
    const source = gmailFixture();
    const f = await fixture({ registration: gmailThreads, provider: source.provider });
    try {
      await f.finish();
      const checkpoint = f.saved.checkpoint;
      source.requests.length = 0;
      source.intercept = ({ path }) =>
        path === '/users/me/history'
          ? Promise.reject({
              code: 'connector_request_failed',
              diagnostics: { service: 'gmail', operation: path, providerStatus: status },
            })
          : undefined;
      f.queue();
      await f.engine.tick();
      expect(f.saved.checkpoint).toEqual(checkpoint);
      expect(f.saved.errorCode).toBe('gmail_checkpoint_invalid_resync_required');
      expect(source.requests.some(({ path }) => path === '/users/me/threads')).toBe(false);
      source.intercept = undefined;
      await f.engine.api.setEnabled({
        actorId: 'alice',
        ownerId: 'alice',
        id: f.saved.id,
        enabled: true,
      });
      await f.engine.api.resync({ actorId: 'alice', ownerId: 'alice', id: f.saved.id });
      await f.finish();
      expect(new Set(f.records.map((record) => record.id)).size).toBe(1);
    } finally {
      await f.close();
    }
  },
);

test('Gmail fails closed for a missing or replaced label and a different mailbox', async () => {
  const source = gmailFixture();
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    source.label = '';
    await f.engine.tick();
    expect(f.saved.errorCode).toBe('gmail_label_missing');
    expect(source.requests.some(({ path }) => path === '/users/me/threads')).toBe(false);
    source.label = 'Label_context';
    await f.engine.api.setEnabled({
      actorId: 'alice',
      ownerId: 'alice',
      id: f.saved.id,
      enabled: true,
    });
    f.queue();
    await f.finish();
    const checkpoint = f.saved.checkpoint;
    source.account = 'other@example.com';
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(checkpoint);
    expect(f.saved.errorCode).toBe('gmail_mailbox_changed');
    source.account = account;
    source.label = 'replacement';
    await f.engine.api.setEnabled({
      actorId: 'alice',
      ownerId: 'alice',
      id: f.saved.id,
      enabled: true,
    });
    f.queue();
    await f.engine.tick();
    expect(f.saved.checkpoint).toEqual(checkpoint);
    expect(f.saved.errorCode).toBe('gmail_checkpoint_invalid_resync_required');
  } finally {
    await f.close();
  }
});
