import { createHash } from 'node:crypto';
import { Elysia, StatusMap, t } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import { ErrorResponseSchema } from '#lib/errors.ts';
import { OPEN_CONNECTOR_RECORDS_PATH } from '#lib/open-connector/config.ts';
import {
  InvalidOpenConnectorDeliveryError,
  isOpenConnectorDeliveryApiKey,
  MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES,
  MAX_OPEN_CONNECTOR_DELIVERY_BYTES,
  MIN_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES,
  type OpenConnectorIntegrationPrincipal,
} from '#models/open-connector/model.ts';
import { OpenConnectorDeliveryEnvelopeSchema } from '#routes/integrations/open-connector/model.ts';
import type { OpenConnectorRecordsServiceContract } from '#services/open-connector/service.ts';

export const OPEN_CONNECTOR_RECORDS_ROUTE_PATH = OPEN_CONNECTOR_RECORDS_PATH;

const DELIVERY_PARSER = 'openConnectorDeliveryJson' as const;
const MAX_IDEMPOTENCY_KEY_LENGTH = 1024;

export const OPEN_CONNECTOR_SECURITY_SCHEME = 'openConnectorBearer';
export const openConnectorSecuritySchemes = {
  [OPEN_CONNECTOR_SECURITY_SCHEME]: {
    type: 'http',
    scheme: 'bearer',
    description: 'Delivery API key assigned to one trusted external service.',
  },
} satisfies Record<string, OpenAPIV3.SecuritySchemeObject>;

const OpenConnectorDeliveryHeadersSchema = t.Object(
  {
    authorization: t.String({
      minLength: 'Bearer '.length + MIN_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES,
      maxLength: 'Bearer '.length + MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES,
      description: 'Bearer delivery API key.',
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
        description: `Optional decimal byte length, no larger than ${MAX_OPEN_CONNECTOR_DELIVERY_BYTES}.`,
      }),
    ),
  },
  { additionalProperties: true },
);

export type OpenConnectorRecordsAcceptanceContract = Pick<
  OpenConnectorRecordsServiceContract,
  'accept' | 'authenticateDeliveryApiKey'
>;

type ParsedDeliveryBody =
  | { state: 'parsed'; value: unknown; payloadHash: string }
  | { state: 'invalid' }
  | { state: 'too_large' };

const errorMessage = {
  unauthorized: 'Unauthorized',
  invalid: 'Invalid open-connector delivery',
  tooLarge: 'Open-connector delivery exceeds the maximum size',
  unsupportedMediaType: 'Content-Type must be application/json',
  conflict: 'Conflicting open-connector delivery',
} as const;

function deliveryApiKey(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  const token = authorization.slice('Bearer '.length);
  return isOpenConnectorDeliveryApiKey(token) &&
    Buffer.byteLength(token, 'utf8') <= MAX_OPEN_CONNECTOR_DELIVERY_API_KEY_BYTES
    ? token
    : null;
}

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
  const payloadDigest = createHash('sha256');
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_OPEN_CONNECTOR_DELIVERY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { state: 'too_large' };
      }
      chunks.push(value);
      payloadDigest.update(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
    return {
      state: 'parsed',
      value: JSON.parse(text) as unknown,
      payloadHash: payloadDigest.digest('hex'),
    };
  } catch {
    return { state: 'invalid' };
  }
}

function isOpenConnectorDeliveryRequest(request: Request): boolean {
  return (
    request.method === 'POST' && new URL(request.url).pathname === OPEN_CONNECTOR_RECORDS_ROUTE_PATH
  );
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
  if (contentLength !== undefined && contentLength > BigInt(MAX_OPEN_CONNECTOR_DELIVERY_BYTES)) {
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

export function createOpenConnectorRecordsController({
  recordsService,
}: {
  recordsService: OpenConnectorRecordsAcceptanceContract;
}) {
  const principals = new WeakMap<Request, OpenConnectorIntegrationPrincipal>();

  return new Elysia({ name: 'open-connector-records' })
    .onRequest(async ({ request, status }) => {
      if (!isOpenConnectorDeliveryRequest(request)) {
        return;
      }

      const apiKey = deliveryApiKey(request);
      const principal = apiKey
        ? await recordsService.authenticateDeliveryApiKey({ deliveryApiKey: apiKey })
        : null;
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
      return { deliveryPayloadHash: parsed.payloadHash };
    })
    .onError(({ code, error, status }) => {
      if (
        code === 'VALIDATION' ||
        code === 'PARSE' ||
        error instanceof InvalidOpenConnectorDeliveryError
      ) {
        return status(StatusMap['Bad Request'], { error: errorMessage.invalid });
      }
    })
    .post(
      OPEN_CONNECTOR_RECORDS_ROUTE_PATH,
      async ({ body, deliveryPayloadHash, request, status }) => {
        if (request.headers.get('idempotency-key') !== body.batchId) {
          return status(StatusMap['Bad Request'], { error: errorMessage.invalid });
        }

        const principal = principals.get(request);
        if (!principal) {
          return status(StatusMap.Unauthorized, { error: errorMessage.unauthorized });
        }
        const result = await recordsService.accept({
          integrationId: principal.integrationId,
          ownerId: principal.ownerId,
          envelope: body,
          payloadHash: deliveryPayloadHash,
        });
        if (result.state === 'conflict') {
          return status(StatusMap.Conflict, { error: errorMessage.conflict });
        }
        return null;
      },
      {
        parse: DELIVERY_PARSER,
        headers: OpenConnectorDeliveryHeadersSchema,
        body: OpenConnectorDeliveryEnvelopeSchema,
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
          tags: ['Open connector'],
          summary: 'Receive an open-connector record batch',
          security: [{ [OPEN_CONNECTOR_SECURITY_SCHEME]: [] }],
        },
      },
    );
}
