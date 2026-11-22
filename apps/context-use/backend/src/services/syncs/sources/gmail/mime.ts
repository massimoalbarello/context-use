import { isUtf8 } from 'node:buffer';
import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import { getStreamAsArrayBuffer } from 'get-stream';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { decode, header, type Message, type MessagePart } from './models.ts';

export type Attachment = { name: string; file: string; contentId: string };
function bodyText(input: { part: MessagePart; bytes: Uint8Array }) {
  const charset =
    /charset\s*=\s*["']?([^\s;"']+)/i.exec(
      header({ part: input.part, name: 'content-type' }),
    )?.[1] ?? 'utf-8';
  const decoder = new TextDecoder(charset);
  // Gmail can return UTF-8 bytes while retaining the sender's original single-byte charset.
  if (/^(windows-125|iso-8859-)/.test(decoder.encoding) && isUtf8(input.bytes)) {
    return new TextDecoder().decode(input.bytes);
  }
  return decoder.decode(input.bytes);
}
function attachment(part: MessagePart) {
  return Boolean(
    part.filename ||
      part.mimeType.startsWith('image/') ||
      /^attachment\b/i.test(header({ part, name: 'content-disposition' })),
  );
}
async function readPart(input: { context: SyncContext; messageId: string; part: MessagePart }) {
  const body = input.part.body;
  if (!body?.attachmentId) {
    if (body?.data !== undefined || body?.size === 0) {
      return decode(body.data ?? '');
    }
    throw new Error('Gmail omitted MIME content.');
  }
  if (!input.context.provider.download) {
    throw new Error('Gmail attachment download is unavailable.');
  }
  const stream = await input.context.provider.download({
    id: 'gmail.download_attachment',
    input: {
      messageId: input.messageId,
      attachmentId: body.attachmentId,
      fileName: input.part.filename || 'message-part',
      mimeType: input.part.mimeType,
    },
  });
  return Buffer.from(await getStreamAsArrayBuffer(stream, { maxBuffer: MAX_ASSET_BYTES }));
}
export async function messageContent(input: {
  context: SyncContext;
  account: string;
  message: Message;
}) {
  const refs: Record<string, AssetRef> = {};
  const attachments: Attachment[] = [];
  const bodies: Record<'text/html' | 'text/plain', string[]> = {
    'text/html': [],
    'text/plain': [],
  };
  const visit = async (part: MessagePart) => {
    if (attachment(part)) {
      if (!part.partId && part !== input.message.payload) {
        throw new Error('Gmail attachment has no stable MIME part identity.');
      }
      const bytes = await readPart({ ...input, messageId: input.message.id, part });
      const version = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
      const id = JSON.stringify([input.account, input.message.id, part.partId]);
      const key = `part_${Buffer.from(id).toString('base64url')}`;
      if (Object.hasOwn(refs, key)) {
        throw new Error('Gmail repeated an attachment part identity.');
      }
      const name = part.filename || `Attachment ${part.partId}`.trimEnd();
      refs[key] = await input.context.assets.capture({
        id,
        version,
        name: name.slice(0, MAX_ASSET_NAME_LENGTH),
        mediaType: part.mimeType,
        read: () => Promise.resolve(new Blob([bytes]).stream()),
      });
      attachments.push({
        name,
        file: assetPlaceholder(key),
        contentId: header({ part, name: 'content-id' }).replace(/^<|>$/g, ''),
      });
      return;
    }
    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
      const bytes = await readPart({ ...input, messageId: input.message.id, part });
      bodies[part.mimeType].push(bodyText({ part, bytes }));
    }
    for (const child of part.parts) {
      await visit(child);
    }
  };
  await visit(input.message.payload);
  return {
    refs,
    attachments,
    html: bodies['text/html'].join('\n'),
    plain: bodies['text/plain'].join('\n'),
  };
}
