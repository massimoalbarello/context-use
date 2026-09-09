import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';

export const RECORD_DELIVERY_VERSION = 1 as const;
export const MAX_RECORD_DELIVERY_BATCH_RECORDS = 50;
export const MAX_RECORD_SEARCH_RESULTS = 50;
export const MAX_RECORD_TITLE_LENGTH = 240;
export const MAX_RECORD_EXCERPT_LENGTH = 280;

const BYTES_PER_KIBIBYTE = 1024;
const KIBIBYTES_PER_MEBIBYTE = 1024;
const RECORD_CONTENT_MEBIBYTES = 8;
const DELIVERY_MEBIBYTES = 16;
export const MAX_RECORD_CONTENT_BYTES =
  RECORD_CONTENT_MEBIBYTES * KIBIBYTES_PER_MEBIBYTE * BYTES_PER_KIBIBYTE;
export const MAX_RECORD_DELIVERY_BYTES =
  DELIVERY_MEBIBYTES * KIBIBYTES_PER_MEBIBYTE * BYTES_PER_KIBIBYTE;

export const RECORD_OPERATIONS = ['added', 'updated', 'deleted'] as const;
export type RecordOperation = (typeof RECORD_OPERATIONS)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RecordParticipant = {
  identities: Array<{ namespace: string; id: string }>;
  roles: string[];
  name?: string;
};

export type RecordContent = {
  body: string;
  sourceUrl?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
  participants?: RecordParticipant[];
  attributes?: Record<string, JsonValue>;
};

export type DeliveredRecord = {
  eventId: string;
  provider: string;
  sourceId: string;
  kind: string;
  id: string;
  revision: number;
  operation: RecordOperation;
  contentHash: string;
  committedAt: string;
  content?: RecordContent;
};

export type RecordDeliveryEnvelope = {
  version: typeof RECORD_DELIVERY_VERSION;
  batchId: string;
  records: DeliveredRecord[];
};

export type RecordIdentity = {
  syncId: string;
  sourceId: string;
  kind: string;
  recordId: string;
};

export type ExternalRecordIdentity = {
  syncReadableId: string;
  sourceId: string;
  kind: string;
  recordId: string;
};

export type StoredRecord = RecordIdentity &
  ExternalRecordIdentity & {
    ownerId: string;
    readableId: string;
    provider: string;
    revision: number;
    operation: RecordOperation;
    contentHash: string;
    committedAt: string;
    content: RecordContent | null;
    currentEventId: string;
    createdAt: string;
    updatedAt: string;
  };

export type RecordSummary = {
  readableId: string;
  title: string;
  excerpt: string;
  sync: { readableId: string; name: string };
  createdAt: string;
  updatedAt: string;
};

export type RecordResource = RecordSummary & {
  markdown: string;
};

export type RecordPage = {
  items: RecordSummary[];
  nextOffset: number | null;
};

export type RecordIngestionJob = RecordIdentity & {
  ownerId: string;
  eventId: string;
  provider: string;
  revision: number;
  operation: RecordOperation;
  contentHash: string;
  committedAt: string;
  content: RecordContent | null;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: string;
};

export type RecordSearchResult = ExternalRecordIdentity & {
  readableId: string;
  provider: string;
  revision: number;
  contentHash: string;
  committedAt: string;
  label: string;
  matchExcerpt: string | null;
};

export type RecordAcceptanceResult =
  | { state: 'accepted' }
  | { state: 'duplicate' }
  | { state: 'inactive_sync' }
  | { state: 'conflict'; reason: 'batch' | 'event' | 'record_revision' };

export class InvalidRecordDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecordDeliveryError';
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function requiredString({ value, name }: { value: string; name: string }): void {
  if (value.trim().length === 0) {
    throw new InvalidRecordDeliveryError(`${name} must not be empty`);
  }
}

function clipped({ value, maximum }: { value: string; maximum: number }): string {
  if (value.length <= maximum) {
    return value;
  }
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

function sha256(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

/** Derives forgiving list presentation without imposing knowledge-page structure on synced data. */
export function recordPresentation(body: string): {
  title: string;
  excerpt: string;
} {
  try {
    const tree = fromMarkdown(body);
    const blocks = tree.children
      .filter((node) => node.type !== 'html' && node.type !== 'definition')
      .map((node) => ({ node, text: mdastToString(node).replace(/\s+/gu, ' ').trim() }))
      .filter(({ text }) => text.length > 0);
    const titleBlock = blocks.find(({ node }) => node.type === 'heading') ?? blocks[0];
    const excerptBlock =
      blocks.find((block) => block !== titleBlock && block.node.type !== 'heading') ??
      blocks.find((block) => block !== titleBlock) ??
      titleBlock;
    return {
      title: clipped({ value: titleBlock?.text || 'Record', maximum: MAX_RECORD_TITLE_LENGTH }),
      excerpt: clipped({
        value: excerptBlock?.text || 'Record',
        maximum: MAX_RECORD_EXCERPT_LENGTH,
      }),
    };
  } catch {
    const fallback = body.replace(/\s+/gu, ' ').trim() || 'Record';
    return {
      title: clipped({ value: fallback, maximum: MAX_RECORD_TITLE_LENGTH }),
      excerpt: clipped({ value: fallback, maximum: MAX_RECORD_EXCERPT_LENGTH }),
    };
  }
}

function validateContent(record: DeliveredRecord): void {
  if (record.operation === 'deleted') {
    if (record.content !== undefined) {
      throw new InvalidRecordDeliveryError('Deleted records must omit content');
    }
    return;
  }
  if (!record.content) {
    throw new InvalidRecordDeliveryError('Added and updated records require content');
  }
  if (record.content.body.trim().length === 0) {
    throw new InvalidRecordDeliveryError('Record content bodies must not be blank');
  }
  const canonicalContent = canonicalRecordContent(record.content);
  if (
    canonicalContent === null ||
    Buffer.byteLength(canonicalContent, 'utf8') > MAX_RECORD_CONTENT_BYTES
  ) {
    throw new InvalidRecordDeliveryError(
      `Canonical record content must not exceed ${MAX_RECORD_CONTENT_BYTES} bytes`,
    );
  }
  if (sha256(canonicalContent) !== record.contentHash) {
    throw new InvalidRecordDeliveryError(
      'Record contentHash must match the canonical record content',
    );
  }
}

export function validateRecordDeliveryEnvelope(envelope: RecordDeliveryEnvelope): void {
  if (envelope.version !== RECORD_DELIVERY_VERSION) {
    throw new InvalidRecordDeliveryError('Unsupported delivery version');
  }
  requiredString({ value: envelope.batchId, name: 'batchId' });
  if (
    envelope.records.length === 0 ||
    envelope.records.length > MAX_RECORD_DELIVERY_BATCH_RECORDS
  ) {
    throw new InvalidRecordDeliveryError(
      `Delivery batches must contain between 1 and ${MAX_RECORD_DELIVERY_BATCH_RECORDS} records`,
    );
  }

  const eventIds = new Set<string>();
  for (const record of envelope.records) {
    requiredString({ value: record.eventId, name: 'eventId' });
    requiredString({ value: record.provider, name: 'provider' });
    requiredString({ value: record.sourceId, name: 'sourceId' });
    requiredString({ value: record.kind, name: 'kind' });
    requiredString({ value: record.id, name: 'id' });
    requiredString({ value: record.committedAt, name: 'committedAt' });
    if (!Number.isSafeInteger(record.revision) || record.revision <= 0) {
      throw new InvalidRecordDeliveryError('Record revisions must be positive safe integers');
    }
    if (!RECORD_OPERATIONS.includes(record.operation)) {
      throw new InvalidRecordDeliveryError('Unsupported record operation');
    }
    if (!SHA256_PATTERN.test(record.contentHash)) {
      throw new InvalidRecordDeliveryError(
        'Record contentHash values must be lowercase SHA-256 digests',
      );
    }
    if (eventIds.has(record.eventId)) {
      throw new InvalidRecordDeliveryError('A delivery batch cannot repeat an eventId');
    }
    eventIds.add(record.eventId);
    validateContent(record);
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidRecordDeliveryError('JSON numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(',')}}`;
}

function contentValue(content: RecordContent): JsonValue {
  const value: Record<string, JsonValue> = { body: content.body };
  if (content.sourceUrl !== undefined) {
    value.sourceUrl = content.sourceUrl;
  }
  if (content.sourceCreatedAt !== undefined) {
    value.sourceCreatedAt = content.sourceCreatedAt;
  }
  if (content.sourceUpdatedAt !== undefined) {
    value.sourceUpdatedAt = content.sourceUpdatedAt;
  }
  if (content.participants !== undefined) {
    value.participants = content.participants.map((participant) => {
      const participantValue: Record<string, JsonValue> = {
        identities: participant.identities.map((identity) => ({
          namespace: identity.namespace,
          id: identity.id,
        })),
        roles: participant.roles,
      };
      if (participant.name !== undefined) {
        participantValue.name = participant.name;
      }
      return participantValue;
    });
  }
  if (content.attributes !== undefined) {
    value.attributes = content.attributes;
  }
  return value;
}

export function canonicalRecordContent(content: RecordContent | undefined): string | null {
  return content === undefined ? null : canonicalJson(contentValue(content));
}

export function canonicalDeliveredRecord(record: DeliveredRecord): string {
  const value: Record<string, JsonValue> = {
    provider: record.provider,
    sourceId: record.sourceId,
    kind: record.kind,
    id: record.id,
    revision: record.revision,
    operation: record.operation,
    contentHash: record.contentHash,
    committedAt: record.committedAt,
  };
  if (record.content !== undefined) {
    value.content = contentValue(record.content);
  }
  return canonicalJson(value);
}
