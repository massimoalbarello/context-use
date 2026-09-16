import { createHash } from 'node:crypto';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.unknown(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});
const TextSchema = z.object({ type: z.literal('text'), text: z.string() });
const CHUNK_CHARS = 6_000;

export type LearningEvidence = { key: string; text: string };

export function evidenceFromMessages(messages: unknown[]): LearningEvidence[] {
  return messages.flatMap((raw) => {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) {
      return [];
    }
    const message = parsed.data;
    const text =
      typeof message.content === 'string'
        ? message.content
        : (Array.isArray(message.content) ? message.content : [])
            .flatMap((part) => {
              const parsed = TextSchema.safeParse(part);
              return parsed.success ? [parsed.data.text] : [];
            })
            .join('\n');
    if (!text.trim()) {
      return [];
    }
    const parts: LearningEvidence[] = [];
    for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
      const value = JSON.stringify({
        role: message.role,
        timestamp: message.timestamp,
        part: offset / CHUNK_CHARS,
        text: text.slice(offset, offset + CHUNK_CHARS),
      });
      parts.push({ key: createHash('sha256').update(value).digest('hex'), text: value });
    }
    return parts;
  });
}
