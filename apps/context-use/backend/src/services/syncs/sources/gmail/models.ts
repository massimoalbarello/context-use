import { z } from 'zod';

export const GMAIL_SYNC_LABEL = 'context-use';
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_ERRORS = {
  labelMissing: 'gmail_label_missing',
  resyncRequired: 'gmail_checkpoint_invalid_resync_required',
  mailboxChanged: 'gmail_mailbox_changed',
} as const;
export const PAGE_SIZE = 10;
export const nativeId = z.string().min(1);
export const historyId = z.string().regex(/^\d+$/);
export const checkpointSchema = z.strictObject({
  account: nativeId.nullable(),
  labelId: nativeId.nullable(),
  phase: z.enum(['initial', 'backfill', 'history']),
  pageToken: nativeId.nullable(),
  historyId: historyId.nullable(),
});
export const initialCheckpoint: z.infer<typeof checkpointSchema> = {
  account: null,
  labelId: null,
  phase: 'initial',
  pageToken: null,
  historyId: null,
};

export interface MessagePart {
  partId: string;
  filename: string;
  mimeType: string;
  headers: { name: string; value: string }[];
  body?: { attachmentId?: string; data?: string };
  parts?: MessagePart[];
}
export const partSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    partId: z.string().default(''),
    filename: z.string().default(''),
    mimeType: z.string().default('application/octet-stream'),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
    body: z.object({ attachmentId: nativeId.optional(), data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
export const messageSchema = z.object({
  id: nativeId,
  threadId: nativeId,
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).default([]),
  payload: partSchema,
});
export const threadSchema = z.object({
  id: nativeId,
  messages: z.array(messageSchema).min(1),
});
export type Message = z.infer<typeof messageSchema>;
export const recordSchema = z.strictObject({
  account: nativeId,
  threadId: nativeId,
  sourceOccurredAt: z.iso.datetime({ offset: true }),
  url: z.url(),
});
export function excluded(labels: string[]) {
  return labels.includes('SPAM') || labels.includes('TRASH');
}
export function header(input: { part: MessagePart; name: string }) {
  const { part, name } = input;
  return part.headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}
const BASE64_BLOCK_LENGTH = 4;
export function decode(data: string) {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data) || data.length % BASE64_BLOCK_LENGTH === 1) {
    throw new Error('Invalid Gmail MIME content.');
  }
  return Buffer.from(data, 'base64url');
}
