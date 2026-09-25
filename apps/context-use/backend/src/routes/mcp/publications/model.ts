import { z } from 'zod';
import type {
  PagePublicationStatus,
  PublicationStatus,
} from '#backend/models/publications/model.ts';

export const McpPublicationSchema = z.object({
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

export const McpPagePublicationSchema = McpPublicationSchema.extend({
  publishedRevisionNumber: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe(
      'The active public revision, which may differ from the latest private revision; null when private.',
    ),
});

export function mcpPublication(publication: PublicationStatus) {
  return {
    publicId: publication.publicId,
    publishedAt: publication.publishedAt,
  };
}

export function mcpPagePublication(publication: PagePublicationStatus) {
  return {
    ...mcpPublication(publication),
    publishedRevisionNumber: publication.publishedRevisionNumber,
  };
}
