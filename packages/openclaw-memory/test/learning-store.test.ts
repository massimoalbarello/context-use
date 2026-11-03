import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { attachmentsFromMessages, evidenceFromMessages } from '../src/learning-evidence';
import {
  DREAM_INTERVAL_MS,
  LearningStore,
  learningDatabase,
  learningProgressDatabase,
} from '../src/learning-store';

const config = { agentId: 'main', serverUrl: 'https://memory.example/mcp' };
const directories: string[] = [];
const stores: LearningStore[] = [];
const NOW = Date.parse('2030-06-20T10:00:00Z');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'learning-test-'));
  const directory = join(root, 'connection');
  directories.push(root);
  const open = (input: { connectionId?: string; config?: typeof config } = {}) => {
    const db = new LearningStore({ directory, config, connectionId: 'owner', ...input });
    stores.push(db);
    return db;
  };
  const close = (db: LearningStore) => {
    db.close();
    stores.splice(stores.indexOf(db), 1);
  };
  return { directory, open, close, db: open() };
}
afterEach(async () => {
  for (const db of stores.splice(0)) {
    db.close();
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test('reset evidence survives reopening, deduplicates completed turns, and preserves new arrivals', async () => {
  const { db, open, directory } = await fixture();
  const evidence = evidenceFromMessages([
    {
      role: 'user',
      content: 'Mira has an exhibition tonight. I will visit the museum.',
      timestamp: NOW,
    },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'You could book admission in advance.' }],
    },
  ]);
  db.capture({ source: 'chat:session-1', evidence, now: NOW });
  db.capture({ source: 'chat:session-1', evidence, now: NOW });
  expect(db.status().pending).toBe(2);
  const job = db.next({ agentId: 'main', now: NOW })!;
  expect(job.evidence).toContain('museum');
  expect(job.evidence).toContain('"role":"assistant"');
  db.started({ id: job.id, runId: 'run-1', now: NOW });
  const reopened = open();
  expect(reopened.current()?.runId).toBe('run-1');
  expect(() => reopened.finish({ id: job.id, now: NOW })).toThrow('acknowledged');
  db.capture({
    source: job.source,
    evidence: evidenceFromMessages([
      { role: 'user', content: "I'll buy admission at the door.", timestamp: NOW + 1 },
    ]),
    now: NOW + 1,
  });
  reopened.acknowledge({ sessionKey: job.sessionKey });
  reopened.finish({ id: job.id, now: NOW });
  db.capture({ source: job.source, evidence, now: NOW });
  expect(db.status().pending).toBe(1);
  expect(db.next({ agentId: 'main', now: NOW })?.evidence).toContain('admission at the door');
  expect(
    (await readFile(join(directory, learningDatabase('owner')))).includes(Buffer.from('museum')),
  ).toBe(false);
  const permissionsMask = 0o777;
  const privateFileMode = 0o600;
  expect((await stat(join(directory, learningDatabase('owner')))).mode & permissionsMask).toBe(
    privateFileMode,
  );
});

test('failed jobs keep evidence and change dispatch identity without accepting stale acknowledgements', async () => {
  const { db } = await fixture();
  db.capture({
    source: 'chat',
    evidence: evidenceFromMessages([{ role: 'user', content: 'Remember my plan.' }]),
    now: NOW,
  });
  const job = db.next({ agentId: 'main', now: NOW })!;
  db.retry({ id: job.id, at: NOW + 1 });
  expect(db.status().pending).toBe(1);
  expect(db.status().retryAt).toBe(NOW + 1);
  expect(db.next({ agentId: 'main', now: NOW })).toBeUndefined();
  expect(db.next({ agentId: 'main', now: NOW + 1 })?.id).not.toBe(job.id);
  expect(() => db.acknowledge({ sessionKey: job.sessionKey })).toThrow('no longer active');
});

test('dreaming runs only after new evidence has been learned and its interval is due', async () => {
  const { db } = await fixture();
  expect(db.next({ agentId: 'main', now: NOW })).toBeUndefined();
  db.capture({
    source: 'chat',
    evidence: evidenceFromMessages([{ role: 'user', content: 'My sister is visiting.' }]),
    now: NOW,
  });
  const job = db.next({ agentId: 'main', now: NOW })!;
  db.acknowledge({ sessionKey: job.sessionKey });
  db.finish({ id: job.id, now: NOW });
  expect(db.next({ agentId: 'main', now: NOW })).toBeUndefined();
  const dream = db.next({ agentId: 'main', now: NOW + DREAM_INTERVAL_MS })!;
  expect(dream.kind).toBe('dream');
  expect(dream.evidence).toBe('');
  db.acknowledge({ sessionKey: dream.sessionKey });
  db.finish({ id: dream.id, now: NOW + DREAM_INTERVAL_MS });
  expect(db.next({ agentId: 'main', now: NOW + DREAM_INTERVAL_MS * 2 })).toBeUndefined();
});

test('a failing conversation does not block learning in other conversations', async () => {
  const { db } = await fixture();
  db.capture({
    source: 'failing-chat',
    evidence: evidenceFromMessages([
      { role: 'user', content: 'A plan needing an unavailable resource.' },
    ]),
    now: NOW,
  });
  const failed = db.next({ agentId: 'main', now: NOW })!;
  const retryDelay = 300_000;
  db.retry({ id: failed.id, at: NOW + retryDelay });
  db.capture({
    source: 'another-chat',
    evidence: evidenceFromMessages([
      { role: 'user', content: 'I am visiting an exhibition tonight.' },
    ]),
    now: NOW,
  });
  const next = db.next({ agentId: 'main', now: NOW })!;
  expect(next.source).toBe('another-chat');
  db.acknowledge({ sessionKey: next.sessionKey });
  db.finish({ id: next.id, now: NOW });
  expect(db.status().pending).toBe(1);
  expect(db.next({ agentId: 'main', now: NOW + retryDelay })?.source).toBe('failing-chat');
});

test('large conversations are drained in bounded batches without losing their final facts', async () => {
  const { db } = await fixture();
  const size = 100_000;
  const content = `${'a'.repeat(size)} I will buy admission at the door.`;
  const evidence = evidenceFromMessages([{ role: 'user', content }]);
  db.capture({ source: 'chat', evidence, now: NOW });
  let combined = '';
  while (db.status().pending) {
    const job = db.next({ agentId: 'main', now: NOW })!;
    const maxBatchChars = 50_000;
    expect(job.evidence.length).toBeLessThan(maxBatchChars);
    combined += job.evidence;
    db.acknowledge({ sessionKey: job.sessionKey });
    db.finish({ id: job.id, now: NOW });
  }
  expect(combined).toContain('I will buy admission at the door.');
});

test('connection ownership is enforced and tool output, reasoning and media bytes are excluded', async () => {
  const { directory, db } = await fixture();
  db.capture({
    source: 'chat',
    evidence: evidenceFromMessages([{ role: 'user', content: 'Private plan.' }]),
    now: NOW,
  });
  const other = new LearningStore({ directory, config, connectionId: 'different-owner' });
  stores.push(other);
  expect(other.status().pending).toBe(0);
  expect(db.status().pending).toBe(1);
  expect(
    () =>
      new LearningStore({
        directory,
        config: { ...config, agentId: 'other' },
        connectionId: 'owner',
      }),
  ).toThrow('different connection');
  expect(
    evidenceFromMessages([
      { role: 'toolResult', content: 'secret tool output' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'private reasoning' }] },
      { role: 'user', content: [{ type: 'image', data: 'raw image bytes' }] },
    ]),
  ).toEqual([]);
});

test('attachment references survive reset and restart, scope uploads to the active job, and require completion', async () => {
  const { db, open } = await fixture();
  const evidence = attachmentsFromMessages([
    {
      role: 'user',
      content: [{ type: 'text', text: 'These files document the exhibition.' }],
      __openclaw: {
        media: [
          { path: '/media/photo.png', fileName: 'Exhibition photo', contentType: 'image/png' },
          { path: '/media/clip.mp4', fileName: 'Exhibition video', contentType: 'video/mp4' },
          {
            path: '/media/guide.pdf',
            fileName: 'Exhibition guide',
            contentType: 'application/pdf',
            hydrationSuppressed: true,
          },
        ],
      },
    },
    { role: 'assistant', __openclaw: { media: [{ path: '/private/unrelated' }] } },
    { role: 'user', content: 'Please read /private/not-an-attachment' },
  ]);
  const attachmentCount = 3;
  expect(evidence).toHaveLength(attachmentCount);
  db.capture({ source: 'chat', evidence, now: NOW });
  db.capture({ source: 'chat', evidence, now: NOW });
  const job = db.next({ agentId: 'main', now: NOW })!;
  expect(job.evidence).not.toContain('/media/');
  expect(job.evidence).toContain('These files document the exhibition.');
  const reopened = open();
  expect(reopened.attachments(job)).toHaveLength(attachmentCount);
  expect(() => reopened.acknowledge({ sessionKey: job.sessionKey })).toThrow('every attachment');
  const [first, second, third] = evidence;
  expect(() => db.savedAttachment({ jobId: job.id, key: 'another-job', asset: '{}' })).toThrow(
    'not part',
  );
  expect(
    db.prepareAttachmentUpload({ jobId: job.id, key: first!.key, name: 'Exhibition photo' }),
  ).toBe('Exhibition photo');
  expect(
    reopened.prepareAttachmentUpload({
      jobId: job.id,
      key: first!.key,
      name: 'Different retry name',
    }),
  ).toBe('Exhibition photo');
  db.savedAttachment({
    jobId: job.id,
    key: first!.key,
    asset: '{"address":"context-use://asset/photo"}',
  });
  db.savedAttachment({
    jobId: job.id,
    key: second!.key,
    asset: '{"address":"context-use://asset/video"}',
  });
  expect(() => db.acknowledge({ sessionKey: job.sessionKey })).toThrow('every attachment');
  db.acknowledge({ sessionKey: job.sessionKey, omittedAttachments: [third!.key] });
  db.finish({ id: job.id, now: NOW });
  expect(reopened.attachments(job)).toEqual([]);
  expect(db.status().pending).toBe(0);
});

test('reauthorization and reinstall skip completed history, retry unfinished evidence, and learn new messages', async () => {
  const { directory, db, open, close } = await fixture();
  const source = 'chat:session-1';
  const completed = [
    ...evidenceFromMessages([{ role: 'user', content: 'I visited the museum.', timestamp: NOW }]),
    ...attachmentsFromMessages([
      { role: 'user', __openclaw: { media: [{ path: '/media/photo.png' }] } },
    ]),
  ];
  db.capture({ source, evidence: completed, now: NOW });
  const first = db.next({ agentId: 'main', now: NOW })!;
  db.savedAttachment({
    jobId: first.id,
    key: completed[1]!.key,
    asset: '{"address":"context-use://asset/museum"}',
  });
  db.acknowledge({ sessionKey: first.sessionKey });
  db.finish({ id: first.id, now: NOW });
  const unfinished = evidenceFromMessages([{ role: 'user', content: 'My next trip is to Bath.' }]);
  db.capture({ source, evidence: unfinished, now: NOW + 1 });
  const pending = db.next({ agentId: 'main', now: NOW + 1 })!;
  db.started({ id: pending.id, runId: 'interrupted', now: NOW + 1 });
  close(db);

  for (const connectionId of ['reauthorized', 'reinstalled']) {
    await rm(directory, { recursive: true, force: true });
    const resumed = open({ connectionId });
    resumed.capture({ source, evidence: completed, now: NOW + 2 });
    expect(resumed.status().pending).toBe(0);
    expect(resumed.next({ agentId: 'main', now: NOW + 2 })).toBeUndefined();
    resumed.capture({ source, evidence: unfinished, now: NOW + 2 });
    expect(resumed.status().pending).toBe(1);
    expect(resumed.next({ agentId: 'main', now: NOW + 2 })?.evidence).toContain('Bath');
    close(resumed);
  }

  const final = open({ connectionId: 'new-arrival' });
  final.capture({
    source,
    evidence: evidenceFromMessages([{ role: 'user', content: 'The train is booked.' }]),
    now: NOW + 2,
  });
  expect(final.status().pending).toBe(1);
  const progressPath = learningProgressDatabase({ directory, config });
  const receiptBytes = await readFile(progressPath);
  expect(receiptBytes.includes(Buffer.from('museum.'))).toBe(false);
  expect(receiptBytes.includes(Buffer.from('/media/photo.png'))).toBe(false);
  const permissionsMask = 0o777;
  const privateFileMode = 0o600;
  expect((await stat(progressPath)).mode & permissionsMask).toBe(privateFileMode);
});

test('saved attachments and uncertain upload names survive authorization changes until curation completes', async () => {
  const { directory, db, open, close } = await fixture();
  const evidence = attachmentsFromMessages([
    {
      role: 'user',
      __openclaw: { media: [{ path: '/media/photo.png' }, { path: '/media/guide.pdf' }] },
    },
  ]);
  db.capture({ source: 'chat', evidence, now: NOW });
  const job = db.next({ agentId: 'main', now: NOW })!;
  const asset = '{"address":"context-use://asset/museum-photo"}';
  db.savedAttachment({ jobId: job.id, key: evidence[0]!.key, asset });
  db.prepareAttachmentUpload({ jobId: job.id, key: evidence[1]!.key, name: 'Museum guide' });
  close(db);
  await rm(directory, { recursive: true });

  const resumed = open({ connectionId: 'reauthorized' });
  resumed.capture({ source: 'chat', evidence, now: NOW + 1 });
  const next = resumed.next({ agentId: 'main', now: NOW + 1 })!;
  expect(resumed.attachments(next)[0]?.asset).toBe(asset);
  expect(
    resumed.prepareAttachmentUpload({ jobId: next.id, key: evidence[1]!.key, name: 'New name' }),
  ).toBe('Museum guide');
  resumed.clearAttachmentUploadName({ jobId: next.id, key: evidence[1]!.key });
  close(resumed);
  await rm(directory, { recursive: true });
  const retried = open({ connectionId: 'retry' });
  retried.capture({ source: 'chat', evidence, now: NOW + 2 });
  const retry = retried.next({ agentId: 'main', now: NOW + 2 })!;
  expect(
    retried.prepareAttachmentUpload({ jobId: retry.id, key: evidence[1]!.key, name: 'New name' }),
  ).toBe('New name');
});

test('durable progress is scoped to the instance, agent, and conversation', async () => {
  const { db, open } = await fixture();
  const evidence = evidenceFromMessages([{ role: 'user', content: 'Remember this plan.' }]);
  db.capture({ source: 'chat', evidence, now: NOW });
  const job = db.next({ agentId: 'main', now: NOW })!;
  db.acknowledge({ sessionKey: job.sessionKey });
  db.finish({ id: job.id, now: NOW });
  for (const [connectionId, ownerConfig] of [
    ['other-server', { ...config, serverUrl: 'https://other.example/mcp' }],
    ['other-agent', { ...config, agentId: 'other' }],
  ] as const) {
    const other = open({ connectionId, config: ownerConfig });
    other.capture({ source: 'chat', evidence, now: NOW });
    expect(other.status().pending).toBe(1);
  }
  db.capture({ source: 'other-chat', evidence, now: NOW });
  expect(db.status().pending).toBe(1);
});

test('existing queues export completed fingerprints and saved assets before their connection is deleted', async () => {
  const { directory, db, open, close } = await fixture();
  const completed = evidenceFromMessages([{ role: 'user', content: 'Already learned.' }]);
  const attachments = attachmentsFromMessages([
    { role: 'user', __openclaw: { media: [{ path: '/media/photo.png' }] } },
  ]);
  db.capture({ source: 'chat', evidence: [...completed, ...attachments], now: NOW });
  close(db);
  // Reproduce the previous release: completed rows and uploads exist only in the queue.
  const legacy = new DatabaseSync(join(directory, learningDatabase('owner')));
  try {
    legacy.prepare('UPDATE evidence SET text = NULL WHERE fingerprint = ?').run(completed[0]!.key);
    legacy
      .prepare('UPDATE attachments SET asset = ?, uploadName = ?')
      .run('{"address":"context-use://asset/photo"}', 'Exhibition photo');
  } finally {
    legacy.close();
  }
  close(open());
  await rm(directory, { recursive: true });
  const resumed = open({ connectionId: 'reauthorized' });
  resumed.capture({ source: 'chat', evidence: [...completed, ...attachments], now: NOW + 1 });
  expect(resumed.status().pending).toBe(1);
  const job = resumed.next({ agentId: 'main', now: NOW + 1 })!;
  expect(resumed.attachments(job)[0]?.asset).toBe('{"address":"context-use://asset/photo"}');
});

test('a failed receipt write rolls back completion and retains retryable evidence', async () => {
  const { directory, db } = await fixture();
  db.capture({
    source: 'chat',
    evidence: evidenceFromMessages([{ role: 'user', content: 'A new plan.' }]),
    now: NOW,
  });
  const job = db.next({ agentId: 'main', now: NOW })!;
  db.acknowledge({ sessionKey: job.sessionKey });
  const progress = new DatabaseSync(learningProgressDatabase({ directory, config }));
  try {
    progress.exec(
      "CREATE TRIGGER reject_completion BEFORE INSERT ON completed BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END",
    );
    expect(() => db.finish({ id: job.id, now: NOW })).toThrow('receipt unavailable');
    expect(db.current()?.id).toBe(job.id);
    expect(db.status().pending).toBe(1);
    expect(progress.prepare('SELECT * FROM completed').all()).toEqual([]);
    progress.exec('DROP TRIGGER reject_completion');
    db.finish({ id: job.id, now: NOW });
    expect(db.status().pending).toBe(0);
    expect(progress.prepare('SELECT source FROM completed').all()).toEqual([{ source: 'chat' }]);
  } finally {
    progress.close();
  }
});
