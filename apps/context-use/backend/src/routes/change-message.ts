import { z } from 'zod';
import { MAX_CHANGE_MESSAGE_LENGTH } from '#backend/models/history/model.ts';

export const ChangeMessageSchema = z
  .string()
  .min(1)
  .max(MAX_CHANGE_MESSAGE_LENGTH)
  .regex(/\S/, 'Describe the change briefly')
  .trim()
  .describe(
    `Write one short sentence (up to ${MAX_CHANGE_MESSAGE_LENGTH} characters) describing the concrete change to this resource. ` +
      'Include why when known; do not invent a reason. Name the changed fact or content, rather than ' +
      'using generic text such as "Updated page". For example: "Corrected Acme’s legal name to match the registry" ' +
      'or "Added the launch date from the announcement". Write for the owner reading their change history; ' +
      'omit tool names, internal identifiers, and secrets.',
  );

export const ChangeMessageBodySchema = z.object({ changeMessage: ChangeMessageSchema });

export function withChangeMessage<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.extend(ChangeMessageBodySchema.shape);
}
