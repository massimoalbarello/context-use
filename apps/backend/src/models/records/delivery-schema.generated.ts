/** Generated from the pinned OpenConnector OpenAPI contract. Do not edit. */
/* biome-ignore-all lint: Generated code mirrors the external contract. */
import { z } from 'zod';
import {
  MAX_RECORD_ATTRIBUTES_BYTES,
  MAX_RECORD_CONTENT_BYTES,
} from '#models/records/delivery-contract.generated.ts';
export const BaseRecordDeliveryEnvelopeSchema = z
  .object({
    version: z.literal(1),
    batchId: z
      .string()
      .uuid()
      .describe('Stable batch identity. Retries preserve this value and the exact request body.'),
    records: z
      .array(
        z.discriminatedUnion('operation', [
          z
            .object({
              eventId: z
                .string()
                .uuid()
                .describe('Stable event identity used to deduplicate retries.'),
              provider: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              sourceId: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              kind: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              id: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              revision: z.number().int().gte(1).lte(9007199254740991),
              operation: z.literal('added'),
              contentHash: z
                .string()
                .regex(new RegExp('^[0-9a-f]{64}$'))
                .describe(
                  'SHA-256 of the canonical JSON record content, or the last content for a deletion.',
                ),
              content: z
                .object({
                  title: z
                    .string()
                    .regex(new RegExp('\\S'))
                    .min(1)
                    .describe(
                      'Descriptive plain-text title chosen by the sync for display and search.',
                    ),
                  body: z
                    .string()
                    .regex(new RegExp('\\S'))
                    .min(1)
                    .describe('Markdown body of the record.'),
                  sourceUrl: z.string().url().regex(new RegExp('^https?://')).optional(),
                  sourceCreatedAt: z.string().datetime({ offset: true }).optional(),
                  sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
                  participants: z
                    .array(
                      z
                        .object({
                          identities: z
                            .array(
                              z
                                .object({
                                  namespace: z.string().regex(new RegExp('\\S')).min(1),
                                  id: z.string().regex(new RegExp('\\S')).min(1),
                                })
                                .strict(),
                            )
                            .min(1)
                            .max(16),
                          roles: z
                            .array(z.string().regex(new RegExp('\\S')).min(1))
                            .min(1)
                            .max(32),
                          name: z.string().regex(new RegExp('\\S')).min(1).optional(),
                        })
                        .strict(),
                    )
                    .max(1000)
                    .optional(),
                  attributes: z
                    .record(z.string(), z.any())
                    .describe(
                      'Provider-defined JSON object, limited to 16 KiB when canonically serialized.',
                    )
                    .optional(),
                })
                .strict(),
              committedAt: z.string().datetime({ offset: true }),
            })
            .strict(),
          z
            .object({
              eventId: z
                .string()
                .uuid()
                .describe('Stable event identity used to deduplicate retries.'),
              provider: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              sourceId: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              kind: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              id: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              revision: z.number().int().gte(1).lte(9007199254740991),
              operation: z.literal('updated'),
              contentHash: z
                .string()
                .regex(new RegExp('^[0-9a-f]{64}$'))
                .describe(
                  'SHA-256 of the canonical JSON record content, or the last content for a deletion.',
                ),
              content: z
                .object({
                  title: z
                    .string()
                    .regex(new RegExp('\\S'))
                    .min(1)
                    .describe(
                      'Descriptive plain-text title chosen by the sync for display and search.',
                    ),
                  body: z
                    .string()
                    .regex(new RegExp('\\S'))
                    .min(1)
                    .describe('Markdown body of the record.'),
                  sourceUrl: z.string().url().regex(new RegExp('^https?://')).optional(),
                  sourceCreatedAt: z.string().datetime({ offset: true }).optional(),
                  sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
                  participants: z
                    .array(
                      z
                        .object({
                          identities: z
                            .array(
                              z
                                .object({
                                  namespace: z.string().regex(new RegExp('\\S')).min(1),
                                  id: z.string().regex(new RegExp('\\S')).min(1),
                                })
                                .strict(),
                            )
                            .min(1)
                            .max(16),
                          roles: z
                            .array(z.string().regex(new RegExp('\\S')).min(1))
                            .min(1)
                            .max(32),
                          name: z.string().regex(new RegExp('\\S')).min(1).optional(),
                        })
                        .strict(),
                    )
                    .max(1000)
                    .optional(),
                  attributes: z
                    .record(z.string(), z.any())
                    .describe(
                      'Provider-defined JSON object, limited to 16 KiB when canonically serialized.',
                    )
                    .optional(),
                })
                .strict(),
              committedAt: z.string().datetime({ offset: true }),
            })
            .strict(),
          z
            .object({
              eventId: z
                .string()
                .uuid()
                .describe('Stable event identity used to deduplicate retries.'),
              provider: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              sourceId: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              kind: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              id: z.string().regex(new RegExp('\\S')).min(1).max(1024),
              revision: z.number().int().gte(1).lte(9007199254740991),
              operation: z.literal('deleted'),
              contentHash: z
                .string()
                .regex(new RegExp('^[0-9a-f]{64}$'))
                .describe(
                  'SHA-256 of the canonical JSON record content, or the last content for a deletion.',
                ),
              committedAt: z.string().datetime({ offset: true }),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .describe('A durable batch delivered by OpenConnector to one configured destination.');

export const DeliveredRecordSchema = BaseRecordDeliveryEnvelopeSchema.shape.records.element;

export const RecordDeliveryEnvelopeSchema = BaseRecordDeliveryEnvelopeSchema.superRefine(
  (envelope, context) => {
    for (const record of envelope.records) {
      if (record.operation === 'deleted') continue;
      if (Buffer.byteLength(JSON.stringify(record.content), 'utf8') > MAX_RECORD_CONTENT_BYTES) {
        context.addIssue({
          code: 'custom',
          message: 'Record content exceeds the delivery contract limit.',
        });
      }
      if (
        record.content.attributes !== undefined &&
        Buffer.byteLength(JSON.stringify(record.content.attributes), 'utf8') >
          MAX_RECORD_ATTRIBUTES_BYTES
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Record attributes exceed the delivery contract limit.',
        });
      }
    }
  },
);
