import { z } from 'zod';
import {
  AssetAddressSchema,
  EntityAddressSchema,
  PageAddressSchema,
} from '#backend/routes/mcp/coordinates.ts';

export const PublicationStatusInputSchema = z.object({
  address: z.union([PageAddressSchema, EntityAddressSchema, AssetAddressSchema]),
});

const PublicationSchema = z.object({
  publicId: z
    .string()
    .nullable()
    .describe(
      'Stable public handle, retained after withdrawal. Its presence does not mean public.',
    ),
  publishedAt: z
    .string()
    .datetime()
    .nullable()
    .describe(
      'Non-null means an active publication; null means private, even with a retained publicId.',
    ),
});

export const PublicationStatusOutputSchema = z.union([
  PublicationSchema.extend({
    resourceType: z.literal('page'),
    publishedRevisionNumber: z
      .number()
      .int()
      .positive()
      .nullable()
      .describe(
        'The active public revision, which may differ from the latest private revision; null when private.',
      ),
  }),
  PublicationSchema.extend({ resourceType: z.enum(['entity', 'asset']) }),
]);
