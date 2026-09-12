import { Elysia, StatusMap, t } from 'elysia';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { MAX_RECORD_DELIVERY_BYTES } from '#models/records/delivery-contract.generated.ts';
import type { RecordSyncPrincipal } from '#models/syncs/model.ts';
import { RecordDeliveryEnvelopeSchema } from '#routes/api/records/delivery-model.generated.ts';
import { authenticateSyncRequest, RECORD_SYNC_SECURITY_SCHEME } from '#routes/sync-auth.ts';
import type { RecordDeliveryAcceptanceContract } from '#services/records/service.ts';
import type { RecordSyncAuthenticationContract } from '#services/syncs/service.ts';

export const RECORD_DELIVERY_ROUTE_PATH = '/api/records/batch';

const DELIVERY_PARSER = 'recordDeliveryJson' as const;
const MAX_IDEMPOTENCY_KEY_LENGTH = 1024;
const UUID_LENGTH = 36;

const RecordDeliveryHeadersSchema = t.Object(
  {
    authorization: t.String({
      minLength: 'Bearer '.length + UUID_LENGTH,
      maxLength: 'Bearer '.length + UUID_LENGTH,
      description: 'Bearer UUIDv7 API key issued by Context Use.',
    }),
    'content-type': t.String({
      minLength: 16,
      description: 'application/json, optionally followed by media-type parameters.',
    }),
    'idempotency-key': t.String({
      minLength: 1,
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
      pattern: '.*\\S.*',
      description: 'Must exactly match the delivery body batchId.',
    }),
    'content-length': t.Optional(
      t.String({
        pattern: '^\\d+$',
        description: `Optional decimal byte length, no larger than ${MAX_RECORD_DELIVERY_BYTES}.`,
      }),
    ),
  },
  { additionalProperties: true },
);

type ParsedDeliveryBody =
  | { state: 'parsed'; value: unknown }
  | { state: 'invalid' }
  | { state: 'too_large' };

const errorMessage = {
  unauthorized: 'Unauthorized',
  invalid: 'Invalid record delivery',
  tooLarge: 'Record delivery exceeds the maximum size',
  unsupportedMediaType: 'Content-Type must be application/json',
  conflict: 'Conflicting record delivery',
} as const;

function hasJsonMediaType(request: Request): boolean {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

function declaredContentLength(request: Request): bigint | undefined | 'invalid' {
  const value = request.headers.get('content-length');
  if (value === null) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    return 'invalid';
  }
  try {
    return BigInt(value);
  } catch {
    return 'invalid';
  }
}

async function cancelBody(request: Request): Promise<void> {
  if (!request.body || request.body.locked) {
    return;
  }
  await request.body.cancel().catch(() => undefined);
}

async function parseDeliveryBody(request: Request): Promise<ParsedDeliveryBody> {
  if (!request.body) {
    return { state: 'invalid' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RECORD_DELIVERY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { state: 'too_large' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
    return { state: 'parsed', value: JSON.parse(text) as unknown };
  } catch {
    return { state: 'invalid' };
  }
}

function isRecordDeliveryRequest(request: Request): boolean {
  return request.method === 'POST' && new URL(request.url).pathname === RECORD_DELIVERY_ROUTE_PATH;
}

function deliveryRequestRejection(request: Request): {
  status: 400 | 413 | 415;
  error: string;
} | null {
  if (!hasJsonMediaType(request)) {
    return {
      status: StatusMap['Unsupported Media Type'],
      error: errorMessage.unsupportedMediaType,
    };
  }
  const contentLength = declaredContentLength(request);
  if (contentLength === 'invalid') {
    return { status: StatusMap['Bad Request'], error: errorMessage.invalid };
  }
  if (contentLength !== undefined && contentLength > BigInt(MAX_RECORD_DELIVERY_BYTES)) {
    return { status: StatusMap['Payload Too Large'], error: errorMessage.tooLarge };
  }
  const idempotencyKey = request.headers.get('idempotency-key');
  if (
    !idempotencyKey ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !/\S/u.test(idempotencyKey)
  ) {
    return { status: StatusMap['Bad Request'], error: errorMessage.invalid };
  }
  return null;
}

export function createRecordDeliveryController({
  recordsService,
  syncsService,
}: {
  recordsService: RecordDeliveryAcceptanceContract;
  syncsService: RecordSyncAuthenticationContract;
}) {
  const principals = new WeakMap<Request, RecordSyncPrincipal>();

  return new Elysia({ name: 'record-delivery' })
    .onRequest(async ({ request, status }) => {
      if (!isRecordDeliveryRequest(request)) {
        return;
      }

      const principal = await authenticateSyncRequest({ request, syncs: syncsService });
      if (!principal) {
        return status(StatusMap.Unauthorized, { error: errorMessage.unauthorized });
      }
      principals.set(request, principal);

      const rejection = deliveryRequestRejection(request);
      if (rejection) {
        await cancelBody(request);
        return status(rejection.status, { error: rejection.error });
      }
    })
    .parser(DELIVERY_PARSER, ({ request }) => parseDeliveryBody(request))
    .derive((context) => {
      const parsed = context.body as unknown as ParsedDeliveryBody;
      if (parsed.state === 'invalid') {
        return context.status(StatusMap['Bad Request'], { error: errorMessage.invalid });
      }
      if (parsed.state === 'too_large') {
        return context.status(StatusMap['Payload Too Large'], { error: errorMessage.tooLarge });
      }

      (context as unknown as { body: unknown }).body = parsed.value;
      return {};
    })
    .onError(({ code, status }) => {
      if (code === 'VALIDATION' || code === 'PARSE') {
        return status(StatusMap['Bad Request'], { error: errorMessage.invalid });
      }
    })
    .post(
      RECORD_DELIVERY_ROUTE_PATH,
      async ({ body, request, status }) => {
        if (request.headers.get('idempotency-key') !== body.batchId) {
          return status(StatusMap['Bad Request'], { error: errorMessage.invalid });
        }

        const principal = principals.get(request);
        if (!principal) {
          return status(StatusMap.Unauthorized, { error: errorMessage.unauthorized });
        }
        const result = await recordsService.accept({
          syncId: principal.syncId,
          ownerId: principal.ownerId,
          envelope: body,
        });
        if (result.state === 'inactive_sync') {
          return status(StatusMap.Unauthorized, { error: errorMessage.unauthorized });
        }
        if (result.state === 'missing_assets') {
          return status(StatusMap.Conflict, {
            error: 'Record references missing or unavailable assets',
          });
        }
        if (result.state === 'conflict') {
          return status(StatusMap.Conflict, { error: errorMessage.conflict });
        }
        return null;
      },
      {
        parse: [DELIVERY_PARSER, 'application/json'],
        headers: RecordDeliveryHeadersSchema,
        body: RecordDeliveryEnvelopeSchema,
        response: {
          [StatusMap.OK]: t.Null(),
          [StatusMap['Bad Request']]: ErrorResponseSchema,
          [StatusMap.Unauthorized]: ErrorResponseSchema,
          [StatusMap.Conflict]: ErrorResponseSchema,
          [StatusMap['Payload Too Large']]: ErrorResponseSchema,
          [StatusMap['Unsupported Media Type']]: ErrorResponseSchema,
          [StatusMap['Internal Server Error']]: ErrorResponseSchema,
        },
        detail: {
          tags: ['Records'],
          summary: 'Receive a record batch from an authorized sync',
          security: [{ [RECORD_SYNC_SECURITY_SCHEME]: [] }],
        },
      },
    );
}
