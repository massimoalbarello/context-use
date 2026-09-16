import { createHash } from 'node:crypto';
import { z } from 'zod';

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.unknown(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});
const TextSchema = z.object({ type: z.literal('text'), text: z.string() });
const MediaSchema = z.object({
  path: z.string().optional(),
  url: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  hydrationSuppressed: z.boolean().optional(),
});
const MediaMessageSchema = z.object({
  role: z.literal('user'),
  timestamp: z.union([z.string(), z.number()]).optional(),
  __openclaw: z.object({ media: z.array(MediaSchema) }),
});
const CHUNK_CHARS = 6_000;

export type LearningAttachment = { reference: string; fileName?: string; contentType?: string };
export type LearningEvidence = { key: string; text: string; attachment?: LearningAttachment };

export function attachmentsFromMessages(messages: unknown[]): LearningEvidence[] {
  return messages.flatMap((raw) => {
    const parsed = MediaMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return [];
    }
    return parsed.data.__openclaw.media.flatMap((media) => {
      const reference = media.path ?? media.url;
      if (!reference || media.hydrationSuppressed) {
        return [];
      }
      const attachment = { reference, fileName: media.fileName, contentType: media.contentType };
      const key = createHash('sha256').update(JSON.stringify(attachment)).digest('hex');
      return [
        {
          key,
          attachment,
          text: JSON.stringify({
            role: 'user',
            timestamp: parsed.data.timestamp,
            attachment: { id: key, fileName: media.fileName, contentType: media.contentType },
          }),
        },
      ];
    });
  });
}

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
