import { z } from 'zod';
import {
  MAX_OPEN_CONNECTOR_BATCH_RECORDS,
  MAX_OPEN_CONNECTOR_RECORD_CONTENT_BYTES,
  OPEN_CONNECTOR_DELIVERY_VERSION,
} from '#models/open-connector/model.ts';

const MAX_IDENTIFIER_LENGTH = 1024;
const BYTES_PER_KIBIBYTE = 1024;
const MAX_ATTRIBUTES_KIBIBYTES = 16;
const MAX_ATTRIBUTES_BYTES = MAX_ATTRIBUTES_KIBIBYTES * BYTES_PER_KIBIBYTE;
const MAX_PARTICIPANT_IDENTITIES = 16;
const MAX_PARTICIPANT_ROLES = 32;
const MAX_RECORD_PARTICIPANTS = 1000;

const OpaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .refine((value) => /\S/u.test(value), 'Identifiers must contain a non-whitespace character.');

const NonemptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => /\S/u.test(value), 'Values must contain a non-whitespace character.');

const SourceUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}, 'Source URLs must be HTTP(S) URLs without credentials.');

const ParticipantSchema = z.strictObject({
  identities: z
    .array(
      z.strictObject({
        namespace: NonemptyStringSchema,
        id: NonemptyStringSchema,
      }),
    )
    .min(1)
    .max(MAX_PARTICIPANT_IDENTITIES),
  roles: z.array(NonemptyStringSchema).min(1).max(MAX_PARTICIPANT_ROLES),
  name: NonemptyStringSchema.optional(),
});

const AttributesSchema = z
  .record(z.string(), z.json())
  .refine(
    (attributes) => Buffer.byteLength(JSON.stringify(attributes), 'utf8') <= MAX_ATTRIBUTES_BYTES,
    `Attributes must be no larger than ${MAX_ATTRIBUTES_BYTES} bytes.`,
  );

const RecordContentSchema = z
  .strictObject({
    body: NonemptyStringSchema,
    sourceUrl: SourceUrlSchema.optional(),
    sourceCreatedAt: z.iso.datetime({ offset: true }).optional(),
    sourceUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    participants: z.array(ParticipantSchema).max(MAX_RECORD_PARTICIPANTS).optional(),
    attributes: AttributesSchema.optional(),
  })
  .refine(
    (content) =>
      Buffer.byteLength(JSON.stringify(content), 'utf8') <= MAX_OPEN_CONNECTOR_RECORD_CONTENT_BYTES,
    `Record content must be no larger than ${MAX_OPEN_CONNECTOR_RECORD_CONTENT_BYTES} bytes.`,
  );

const CommonRecordShape = {
  eventId: OpaqueIdentifierSchema,
  provider: OpaqueIdentifierSchema,
  sourceId: OpaqueIdentifierSchema,
  kind: OpaqueIdentifierSchema,
  id: OpaqueIdentifierSchema,
  revision: z.number().positive().refine(Number.isSafeInteger, 'Revisions must be safe integers.'),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
  committedAt: z.iso.datetime({ offset: true }),
};

const AddedRecordSchema = z.strictObject({
  ...CommonRecordShape,
  operation: z.literal('added'),
  content: RecordContentSchema,
});

const UpdatedRecordSchema = z.strictObject({
  ...CommonRecordShape,
  operation: z.literal('updated'),
  content: RecordContentSchema,
});

const DeletedRecordSchema = z.strictObject({
  ...CommonRecordShape,
  operation: z.literal('deleted'),
});

export const OpenConnectorDeliveryEnvelopeSchema = z
  .strictObject({
    version: z.literal(OPEN_CONNECTOR_DELIVERY_VERSION),
    batchId: OpaqueIdentifierSchema,
    records: z
      .array(
        z.discriminatedUnion('operation', [
          AddedRecordSchema,
          UpdatedRecordSchema,
          DeletedRecordSchema,
        ]),
      )
      .min(1)
      .max(MAX_OPEN_CONNECTOR_BATCH_RECORDS),
  })
  .refine(
    (envelope) =>
      new Set(envelope.records.map((record) => record.eventId)).size === envelope.records.length,
    'Event IDs must be unique within a batch.',
  );
