import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';
import type {
  DeliveredRecord as GeneratedDeliveredRecord,
  RecordContent as GeneratedRecordContent,
  RecordDeliveryEnvelope as GeneratedRecordDeliveryEnvelope,
  RecordOperation as GeneratedRecordOperation,
  RecordParticipant as GeneratedRecordParticipant,
} from '#models/records/delivery-contract.generated.ts';
import {
  MAX_RECORD_ATTRIBUTES_BYTES as GENERATED_MAX_RECORD_ATTRIBUTES_BYTES,
  MAX_RECORD_CONTENT_BYTES as GENERATED_MAX_RECORD_CONTENT_BYTES,
  MAX_RECORD_DELIVERY_BATCH_RECORDS as GENERATED_MAX_RECORD_DELIVERY_BATCH_RECORDS,
  MAX_RECORD_DELIVERY_BYTES as GENERATED_MAX_RECORD_DELIVERY_BYTES,
  RECORD_DELIVERY_VERSION as GENERATED_RECORD_DELIVERY_VERSION,
} from '#models/records/delivery-contract.generated.ts';

export const MAX_RECORD_TITLE_LENGTH = 240;
export const MAX_RECORD_EXCERPT_LENGTH = 280;

export const MAX_RECORD_ATTRIBUTES_BYTES = GENERATED_MAX_RECORD_ATTRIBUTES_BYTES;
export const MAX_RECORD_CONTENT_BYTES = GENERATED_MAX_RECORD_CONTENT_BYTES;
export const MAX_RECORD_DELIVERY_BATCH_RECORDS = GENERATED_MAX_RECORD_DELIVERY_BATCH_RECORDS;
export const MAX_RECORD_DELIVERY_BYTES = GENERATED_MAX_RECORD_DELIVERY_BYTES;
export const RECORD_DELIVERY_VERSION = GENERATED_RECORD_DELIVERY_VERSION;
export type DeliveredRecord = GeneratedDeliveredRecord;
export type RecordContent = GeneratedRecordContent;
export type RecordDeliveryEnvelope = GeneratedRecordDeliveryEnvelope;
export type RecordOperation = GeneratedRecordOperation;
export type RecordParticipant = GeneratedRecordParticipant;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RecordIdentity = {
  syncId: string;
  sourceId: string;
  kind: string;
  recordId: string;
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

export type RecordAcceptanceResult =
  | { state: 'accepted' }
  | { state: 'inactive_sync' }
  | { state: 'conflict'; reason: 'record_revision' };

export class InvalidRecordDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecordDeliveryError';
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
    return;
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
  if (
    record.content.attributes !== undefined &&
    Buffer.byteLength(canonicalJson(record.content.attributes as JsonValue), 'utf8') >
      MAX_RECORD_ATTRIBUTES_BYTES
  ) {
    throw new InvalidRecordDeliveryError(
      `Canonical record attributes must not exceed ${MAX_RECORD_ATTRIBUTES_BYTES} bytes`,
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
  for (const record of envelope.records) {
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
    value.attributes = content.attributes as JsonValue;
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
  if ('content' in record) {
    value.content = contentValue(record.content);
  }
  return canonicalJson(value);
}
