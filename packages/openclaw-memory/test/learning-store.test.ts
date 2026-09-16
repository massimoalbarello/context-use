import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachmentsFromMessages, evidenceFromMessages } from '../src/learning-evidence';
import { DREAM_INTERVAL_MS, LearningStore, learningDatabase } from '../src/learning-store';

const config = { agentId: 'main', serverUrl: 'https://memory.example/mcp' };
const directories: string[] = [];
const stores: LearningStore[] = [];
const NOW = Date.parse('2030-06-20T10:00:00Z');
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'learning-test-'));
  directories.push(directory);
  const open = () => {
    const db = new LearningStore({ directory, config, connectionId: 'owner' });
    stores.push(db);
    return db;
  };
  return { directory, open, db: open() };
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
      __openclaw: {
        media: [
          { path: '/media/photo.png', fileName: 'Exhibition photo', contentType: 'image/png' },
          { path: '/media/clip.mp4', fileName: 'Exhibition video', contentType: 'video/mp4' },
          {
            path: '/media/guide.pdf',
            fileName: 'Exhibition guide',
            contentType: 'application/pdf',
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
