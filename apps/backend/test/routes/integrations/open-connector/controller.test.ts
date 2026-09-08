import { expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Elysia, StatusMap } from 'elysia';
import {
  MAX_OPEN_CONNECTOR_BATCH_RECORDS,
  MAX_OPEN_CONNECTOR_DELIVERY_BYTES,
  MAX_OPEN_CONNECTOR_RECORD_CONTENT_BYTES,
  type OpenConnectorDeliveryEnvelope,
} from '#models/open-connector/model.ts';
import {
  createOpenConnectorRecordsController,
  OPEN_CONNECTOR_RECORDS_ROUTE_PATH,
  type OpenConnectorRecordsAcceptanceContract,
} from '#routes/integrations/open-connector/controller.ts';

const integrationId = 'open-connector';
const ownerId = 'owner-id';
const receiverToken = 'receiver-secret';
const batchId = 'batch-id';
const SHA256_HEX_LENGTH = 64;
const SENDER_VALID_LONG_PARTICIPANT_VALUE_LENGTH = 1_025;

function validEnvelope(): OpenConnectorDeliveryEnvelope {
  return {
    version: 1,
    batchId,
    records: [
      {
        eventId: 'event-id',
        provider: 'github',
        sourceId: 'source-id',
        kind: 'pull-request',
        id: 'opaque-record-id',
        revision: 1,
        operation: 'added',
        contentHash: 'a'.repeat(SHA256_HEX_LENGTH),
        committedAt: '2026-09-08T12:34:56.123Z',
        content: {
          body: '# Pull request',
          sourceUrl: 'https://github.com/example/repository/pull/1',
          sourceCreatedAt: '2026-09-01T10:00:00.123456Z',
          sourceUpdatedAt: '2026-09-08T11:00:00Z',
          participants: [
            {
              identities: [{ namespace: 'github', id: 'user-node-id' }],
              roles: ['author'],
              name: 'octocat',
            },
          ],
          attributes: { repository: 'example/repository', number: 1, draft: false },
        },
      },
    ],
  };
}

function request({
  body,
  authorization = `Bearer ${receiverToken}`,
  contentType = 'application/json',
  idempotencyKey = batchId,
  headers,
}: {
  body: RequestInit['body'];
  authorization?: string;
  contentType?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}): Request {
  return new Request(`http://localhost${OPEN_CONNECTOR_RECORDS_ROUTE_PATH}`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': contentType,
      'idempotency-key': idempotencyKey,
      ...headers,
    },
    body,
  });
}

function controller(
  accept: OpenConnectorRecordsAcceptanceContract['accept'] = async () => ({ state: 'accepted' }),
) {
  return createOpenConnectorRecordsController({
    integrationId,
    ownerId,
    receiverToken,
    recordsService: { accept },
  });
}

function firstRecord(envelope: OpenConnectorDeliveryEnvelope) {
  const record = envelope.records[0];
  if (!record) {
    throw new Error('Expected a record');
  }
  return record;
}

function firstContent(envelope: OpenConnectorDeliveryEnvelope) {
  const content = firstRecord(envelope).content;
  if (!content) {
    throw new Error('Expected record content');
  }
  return content;
}

test('authenticates before reading or inspecting the delivery body', async () => {
  let pulls = 0;
  const unreadBody = new ReadableStream<Uint8Array>(
    {
      pull(stream) {
        pulls += 1;
        stream.enqueue(new TextEncoder().encode('{ invalid json'));
      },
    },
    { highWaterMark: 0 },
  );
  const delivery = request({
    authorization: 'Bearer wrong-secret',
    contentType: 'text/plain',
    idempotencyKey: '',
    body: unreadBody,
    headers: { 'content-length': String(MAX_OPEN_CONNECTOR_DELIVERY_BYTES + 1) },
  });

  const response = await controller().handle(delivery);

  expect(response.status).toBe(StatusMap.Unauthorized);
  expect(pulls).toBe(0);
  expect(delivery.bodyUsed).toBe(false);
});

test('accepts a valid batch and passes explicit ownership plus the raw payload hash', async () => {
  const envelope = validEnvelope();
  const rawBody = `${JSON.stringify(envelope)}  `;
  const accept = mock<OpenConnectorRecordsAcceptanceContract['accept']>(async () => ({
    state: 'accepted',
  }));

  const response = await controller(accept).handle(request({ body: rawBody }));

  expect(response.status).toBe(StatusMap.OK);
  expect(await response.text()).toBe('');
  expect(accept).toHaveBeenCalledTimes(1);
  expect(accept).toHaveBeenCalledWith({
    integrationId,
    ownerId,
    envelope,
    payloadHash: createHash('sha256').update(rawBody).digest('hex'),
  });
});

test('acknowledges duplicate batches and returns a fixed conflict response', async () => {
  const duplicate = await controller(async () => ({ state: 'duplicate' })).handle(
    request({ body: JSON.stringify(validEnvelope()) }),
  );
  expect(duplicate.status).toBe(StatusMap.OK);

  const conflict = await controller(async () => ({
    state: 'conflict',
    reason: 'batch',
  })).handle(request({ body: JSON.stringify(validEnvelope()) }));
  expect(conflict.status).toBe(StatusMap.Conflict);
  expect(await conflict.json()).toEqual({ error: 'Conflicting open-connector delivery' });
});

test('does not acknowledge a durable acceptance failure and allows the sender to retry', async () => {
  let failAcceptance = true;
  const receiver = controller(() => {
    if (failAcceptance) {
      failAcceptance = false;
      return Promise.reject(new Error('simulated durable write failure'));
    }
    return Promise.resolve({ state: 'accepted' });
  });
  const body = JSON.stringify(validEnvelope());

  const failed = await receiver.handle(request({ body }));
  expect(failed.status).toBe(StatusMap['Internal Server Error']);

  const retried = await receiver.handle(request({ body }));
  expect(retried.status).toBe(StatusMap.OK);
});

test('requires JSON media type only after successful authentication', async () => {
  const body = JSON.stringify(validEnvelope());
  const unauthorized = await controller().handle(
    request({ authorization: 'Bearer wrong-secret', contentType: 'text/plain', body }),
  );
  expect(unauthorized.status).toBe(StatusMap.Unauthorized);

  const unsupported = await controller().handle(request({ contentType: 'text/plain', body }));
  expect(unsupported.status).toBe(StatusMap['Unsupported Media Type']);
});

test('rejects a declared oversized body before parsing it', async () => {
  let pulls = 0;
  let cancelled = false;
  const unreadBody = new ReadableStream<Uint8Array>(
    {
      pull() {
        pulls += 1;
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  const response = await controller().handle(
    request({
      body: unreadBody,
      headers: { 'content-length': String(MAX_OPEN_CONNECTOR_DELIVERY_BYTES + 1) },
    }),
  );

  expect(response.status).toBe(StatusMap['Payload Too Large']);
  expect(pulls).toBe(0);
  expect(cancelled).toBe(true);
});

test('cancels a streamed body as soon as its actual size exceeds the delivery limit', async () => {
  let pulls = 0;
  let cancelled = false;
  const oversizedBody = new ReadableStream<Uint8Array>(
    {
      pull(stream) {
        pulls += 1;
        stream.enqueue(new Uint8Array(pulls === 1 ? MAX_OPEN_CONNECTOR_DELIVERY_BYTES : 1));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  const response = await controller().handle(request({ body: oversizedBody }));

  expect(response.status).toBe(StatusMap['Payload Too Large']);
  expect(pulls).toBe(2);
  expect(cancelled).toBe(true);
});

test('allows an exact-limit body and rejects malformed JSON cleanly', async () => {
  const rawEnvelope = JSON.stringify(validEnvelope());
  const exactLimitBody = `${rawEnvelope}${' '.repeat(
    MAX_OPEN_CONNECTOR_DELIVERY_BYTES - Buffer.byteLength(rawEnvelope),
  )}`;

  const accepted = await controller().handle(request({ body: exactLimitBody }));
  expect(accepted.status).toBe(StatusMap.OK);

  const malformed = await controller().handle(request({ body: '{' }));
  expect(malformed.status).toBe(StatusMap['Bad Request']);
  expect(await malformed.json()).toEqual({ error: 'Invalid open-connector delivery' });
});

test('enforces the canonical per-record content limit', async () => {
  const envelope = validEnvelope();
  const emptyContentBytes = Buffer.byteLength(JSON.stringify({ body: '' }));
  firstRecord(envelope).content = {
    body: 'x'.repeat(MAX_OPEN_CONNECTOR_RECORD_CONTENT_BYTES - emptyContentBytes),
  };

  const accepted = await controller().handle(request({ body: JSON.stringify(envelope) }));
  expect(accepted.status).toBe(StatusMap.OK);

  firstContent(envelope).body += 'x';
  const oversized = await controller().handle(request({ body: JSON.stringify(envelope) }));
  expect(oversized.status).toBe(StatusMap['Bad Request']);
});

test('validates the whole batch before calling the acceptance service', async () => {
  const envelope = validEnvelope();
  envelope.records.push({
    ...envelope.records[0]!,
    eventId: 'second-event',
    id: 'second-record',
    revision: Number.MAX_SAFE_INTEGER + 1,
  });
  const accept = mock<OpenConnectorRecordsAcceptanceContract['accept']>(async () => ({
    state: 'accepted',
  }));

  const response = await controller(accept).handle(request({ body: JSON.stringify(envelope) }));

  expect(response.status).toBe(StatusMap['Bad Request']);
  expect(accept).not.toHaveBeenCalled();
});

test('enforces record count, deletion shape, hashes, and nonempty Markdown', async () => {
  const cases: unknown[] = [];

  const tooMany = validEnvelope();
  let recordIndex = 0;
  tooMany.records = Array.from({ length: MAX_OPEN_CONNECTOR_BATCH_RECORDS + 1 }, () => {
    const index = recordIndex;
    recordIndex += 1;
    return {
      ...tooMany.records[0]!,
      eventId: `event-${index}`,
      id: `record-${index}`,
    };
  });
  cases.push(tooMany);

  const deletionWithContent = validEnvelope();
  deletionWithContent.records[0] = {
    ...deletionWithContent.records[0]!,
    operation: 'deleted',
  } as OpenConnectorDeliveryEnvelope['records'][number];
  cases.push(deletionWithContent);

  const invalidHash = validEnvelope();
  invalidHash.records[0]!.contentHash = 'A'.repeat(SHA256_HEX_LENGTH);
  cases.push(invalidHash);

  const emptyMarkdown = validEnvelope();
  firstContent(emptyMarkdown).body = '   ';
  cases.push(emptyMarkdown);

  for (const envelope of cases) {
    const response = await controller().handle(request({ body: JSON.stringify(envelope) }));
    expect(response.status).toBe(StatusMap['Bad Request']);
  }
});

test('preserves sender-valid opaque participant values without receiver-only length caps', async () => {
  const envelope = validEnvelope();
  const participant = firstContent(envelope).participants?.[0];
  if (!participant) {
    throw new Error('Expected a participant');
  }
  participant.identities[0] = {
    namespace: 'n'.repeat(SENDER_VALID_LONG_PARTICIPANT_VALUE_LENGTH),
    id: 'i'.repeat(SENDER_VALID_LONG_PARTICIPANT_VALUE_LENGTH),
  };
  participant.roles = ['r'.repeat(SENDER_VALID_LONG_PARTICIPANT_VALUE_LENGTH)];

  const response = await controller().handle(request({ body: JSON.stringify(envelope) }));

  expect(response.status).toBe(StatusMap.OK);
});

test('requires the idempotency key to match the validated batch ID', async () => {
  const mismatch = await controller().handle(
    request({ body: JSON.stringify(validEnvelope()), idempotencyKey: 'different-batch' }),
  );
  expect(mismatch.status).toBe(StatusMap['Bad Request']);

  const missing = await controller().handle(
    new Request(`http://localhost${OPEN_CONNECTOR_RECORDS_ROUTE_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${receiverToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(validEnvelope()),
    }),
  );
  expect(missing.status).toBe(StatusMap['Bad Request']);
});

test('keeps its authentication hook local to the integration route', async () => {
  const app = new Elysia()
    .use(controller())
    .post('/unrelated', () => new Response(null, { status: StatusMap['No Content'] }));

  const response = await app.handle(new Request('http://localhost/unrelated', { method: 'POST' }));

  expect(response.status).toBe(StatusMap['No Content']);
});
