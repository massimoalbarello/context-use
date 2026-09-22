import { z } from 'zod';
import { MAX_CHANGE_MESSAGE_LENGTH } from '#backend/models/history/model.ts';

export const ChangeMessageSchema = z
  .string()
  .min(1)
  .max(MAX_CHANGE_MESSAGE_LENGTH)
  .regex(/\S/, 'Describe the change briefly')
  .trim()
  .describe(
    `Briefly describe what changed and why, if known (max ${MAX_CHANGE_MESSAGE_LENGTH} characters). ` +
      'For example: "Corrected Acme’s legal name".',
  );

export const ChangeMessageBodySchema = z.object({ changeMessage: ChangeMessageSchema });

export function withChangeMessage<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.extend(ChangeMessageBodySchema.shape);
}
