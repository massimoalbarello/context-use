import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { OWNER_USER_ID } from '#backend/lib/auth/owner-registration.ts';
import { SyncCatalog } from '#backend/services/syncs/catalog.ts';
import { ManagedSyncsService } from '#backend/services/syncs/managed.ts';
import { gmailThreads } from '#backend/services/syncs/sources/gmail/definition.ts';
import { gmailProvider } from '#backend/services/syncs/sources/gmail/provider.ts';
import { fixture } from '../engine-fixture.ts';
import { connectedProviders } from '../provider-fixture.ts';
import {
  account,
  attachedMessage,
  completedHistory,
  gmailFixture,
  initialHistory,
  message,
} from './fixture.ts';

beforeEach(() => setSystemTime(new Date('2026-11-30T12:00:00Z')));
afterEach(() => setSystemTime());

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
      { maxResults: 1, includeSpamTrash: false, labelIds: 'Label_context' },
      { maxResults: 1, includeSpamTrash: false, labelIds: 'Label_context', pageToken: '1' },
      { maxResults: 1, includeSpamTrash: false, labelIds: 'Label_context', pageToken: '2' },
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

test('Gmail skips old threads and imports the whole conversation when an unlabelled reply reaches the cutoff', async () => {
  setSystemTime(new Date('2026-08-31T12:00:00Z'));
  const source = gmailFixture();
  const original = {
    ...attachedMessage(),
    internalDate: String(Date.parse('2026-02-28T11:59:59.999Z')),
  };
  const spam = message({
    id: 'spam',
    text: 'Spam',
    labels: ['SPAM'],
    date: '2026-08-30T12:00:00Z',
  });
  source.thread = { ...source.thread, messages: [original, spam] };
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    expect(f.records).toHaveLength(0);
    expect(source.downloads).toHaveLength(0);
    expect(source.requests.filter(({ query }) => query.format === 'full')).toHaveLength(0);

    source.historyPages = [
      {
        history: [{ messagesAdded: [{ message: { threadId: 'thread-one' } }] }],
        historyId: '9007199254740993020',
      },
    ];
    source.thread = {
      ...source.thread,
      messages: [
        original,
        message({ id: 'reply', labels: [], text: 'Received', date: '2026-02-28T12:00:00Z' }),
      ],
    };
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      createdAt: '2026-02-28T11:59:59.999Z',
      updatedAt: '2026-02-28T12:00:00.000Z',
      content: { body: expect.stringContaining('Received') },
    });
    expect(f.deliveries[0]!.assets).toHaveLength(2);

    setSystemTime(new Date('2026-09-01T12:00:00Z'));
    source.requests.length = 0;
    f.queue();
    await f.finish();
    expect(f.records).toHaveLength(1);
    expect(source.requests.filter(({ query }) => query.format === 'full')).toHaveLength(0);
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

test('Gmail downloads attached files and visible images while skipping signature and template images', async () => {
  const source = gmailFixture();
  source.listings = [{ threads: [{ id: 'thread-one' }] }];
  const image = ({ cid, disposition = 'inline' }: { cid: string; disposition?: string }) => ({
    partId: cid,
    filename: `${cid}.png`,
    mimeType: 'image/png',
    headers: [
      { name: 'Content-ID', value: `<${cid}>` },
      { name: 'Content-Disposition', value: disposition },
    ],
    body: { attachmentId: cid },
  });
  const html = [
    '<img src="cid:banner" alt="courtyard.jpg">',
    '<p>See the chart and <a href="CID:detail">detail</a>.</p><img src="cid:chart" alt="Revenue">',
    '<div data-smartmail="gmail_signature">Sales team<a href="cid:contact">Contact card</a><img src="cid:logo"><img src="cid:chart"><img src="cid:attached"></div>',
    '<img src="cid:pixel" width="1" height="1"><span hidden><img src="cid:tile"></span>',
    '<a href="https://www.instagram.com/company/"><img src="cid:social" alt="Instagram"></a>',
    '<a href="https://example.com"><img src="cid:brand" alt="Company logo"></a>',
    '<p><span><a href="https://facebook.com/example/"><img src="cid:fb" alt="Facebook Example Company"></a></span><a href="https://youtube.com/watch?v=intro"><img src="cid:video" alt="YouTube Example Company"></a></p>',
    '<p><a href="https://youtube.com/watch?v=results"><img src="cid:results" alt="YouTube Revenue Breakdown"></a></p>',
    '<blockquote>Original payment terms.</blockquote>',
  ].join('');
  source.thread = {
    ...source.thread,
    messages: [
      {
        ...message({ id: 'signed', text: '' }),
        payload: {
          mimeType: 'multipart/mixed',
          parts: [
            {
              partId: 'text',
              mimeType: 'text/html',
              body: { data: Buffer.from(html).toString('base64url') },
            },
            ...[
              'chart',
              'detail',
              'logo',
              'pixel',
              'tile',
              'social',
              'brand',
              'fb',
              'video',
              'results',
              'banner',
              'orphan',
            ].map((cid) => image({ cid })),
            image({ cid: 'attached', disposition: 'attachment' }),
            {
              ...image({ cid: 'contact', disposition: 'attachment' }),
              filename: 'contact.vcf',
              mimeType: 'text/vcard',
            },
            {
              ...image({ cid: 'photo', disposition: 'attachment' }),
              filename: 'image001.png',
              headers: [{ name: 'Content-Disposition', value: 'attachment' }],
            },
          ],
        },
      },
    ],
  };
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    expect(source.downloads.toSorted()).toEqual(['chart', 'detail', 'photo']);
    const record = f.records[0]!;
    if (record.operation !== 'upsert') {
      throw new Error('Expected an imported thread');
    }
    expect(record.content?.body).not.toContain('![');
    expect(record.content?.body).toContain('See the chart and detail.');
    expect(record.content?.body).toContain(
      '[YouTube Revenue Breakdown](https://youtube.com/watch?v=results)',
    );
    expect(record.content?.body).toContain('Original payment terms.');
    expect(record.content?.body).not.toMatch(
      /Sales team|logo.png|tile.png|pixel.png|instagram|brand.png/i,
    );
    expect(f.deliveries[0]!.assets.map((asset) => asset.name).toSorted()).toEqual([
      'chart.png',
      'detail.png',
      'image001.png',
    ]);
  } finally {
    await f.close();
  }
});

test('Gmail renders accents in normalized UTF-8 and original Latin-1 MIME parts', async () => {
  const source = gmailFixture();
  const parts = [
    Buffer.from('martedì è pronto', 'utf8'),
    Buffer.from('caffè già pagato', 'latin1'),
  ];
  source.thread = {
    ...source.thread,
    messages: Array.from(parts.entries(), ([index, bytes]) => ({
      ...message({ id: String(index), text: '' }),
      payload: {
        mimeType: 'text/plain',
        headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
        body: { data: bytes.toString('base64url') },
      },
    })),
  };
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    const record = f.records[0]!;
    if (record.operation !== 'upsert') {
      throw new Error('Expected an imported thread');
    }
    expect(record.content?.body).toContain('martedì è pronto');
    expect(record.content?.body).toContain('caffè già pagato');
  } finally {
    await f.close();
  }
});

test('single-part attachments and empty text messages import together', async () => {
  const source = gmailFixture();
  source.thread = {
    ...source.thread,
    messages: [
      {
        ...message({ id: 'file', text: '' }),
        payload: {
          partId: '',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          body: { attachmentId: 'invoice-bytes' },
        },
      },
      {
        ...message({ id: 'empty', text: '' }),
        payload: { mimeType: 'text/plain', body: { size: 0 } },
      },
    ],
  };
  const f = await fixture({ registration: gmailThreads, provider: source.provider });
  try {
    await f.finish();
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      content: { body: expect.stringContaining('**Attachments** · [invoice.pdf]') },
    });
    expect(f.deliveries[0]!.assets).toEqual([
      expect.objectContaining({ name: 'invoice.pdf', size: 'Attachment bytes'.length }),
    ]);
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
    const f = await fixture({
      registration: gmailThreads,
      provider: source.provider,
      ownerId: OWNER_USER_ID,
    });
    const actor = { actorId: OWNER_USER_ID };
    const sync = { ...actor, key: gmailThreads.definition.id };
    const service = new ManagedSyncsService({
      catalog: new SyncCatalog([gmailProvider]),
      sync: {
        api: f.engine.api,
        providers: connectedProviders([
          { id: 'connection', service: 'gmail', account, status: 'active', authType: 'oauth2' },
        ]),
      },
    });
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
      expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('reprocess-required');
      for (const action of ['resume', 'run'] as const) {
        await expect(service.update({ ...sync, action })).rejects.toThrow('Reprocess history');
      }
      // Keep rejecting the old cursor. Only restarting the backfill can recover.
      await service.update({ ...sync, action: 'resync' });
      expect(f.saved.checkpoint.phase).toBe('initial');
      source.intercept = undefined;
      await f.finish();
      expect((await service.list(actor))[0]?.syncs[0]?.state).toBe('ready');
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
