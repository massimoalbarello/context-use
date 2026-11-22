import { isUtf8 } from 'node:buffer';
import { type AssetRef, assetPlaceholder } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import { getStreamAsArrayBuffer } from 'get-stream';
import { MAX_ASSET_BYTES, MAX_ASSET_NAME_LENGTH } from '#backend/models/assets/model.ts';
import { type Attachment, readableBody } from './content.ts';
import { decode, header, type Message, type MessagePart } from './models.ts';

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
function explicitAttachment(part: MessagePart) {
  return /^attachment\b/i.test(header({ part, name: 'content-disposition' }).trim());
}
function attachment(part: MessagePart) {
  return Boolean(part.filename || part.mimeType.startsWith('image/') || explicitAttachment(part));
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
  previous: string[];
}) {
  const parts = new Map<string, { part: MessagePart; id: string; asset: Attachment }>();
  const bodies: Record<'text/html' | 'text/plain', string[]> = {
    'text/html': [],
    'text/plain': [],
  };
  const visit = async (part: MessagePart) => {
    if (attachment(part)) {
      if (!part.partId && part !== input.message.payload) {
        throw new Error('Gmail attachment has no stable MIME part identity.');
      }
      const id = JSON.stringify([input.account, input.message.id, part.partId]);
      const key = `part_${Buffer.from(id).toString('base64url')}`;
      if (parts.has(key)) {
        throw new Error('Gmail repeated an attachment part identity.');
      }
      const asset = {
        name: part.filename || `Attachment ${part.partId}`.trimEnd(),
        file: assetPlaceholder(key),
        contentId: header({ part, name: 'content-id' }).trim().replace(/^<|>$/g, ''),
      };
      parts.set(key, { id, part, asset });
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
  const readable = readableBody({
    html: bodies['text/html'].join('\n'),
    plain: bodies['text/plain'].join('\n'),
    attachments: Array.from(parts.values(), ({ asset }) => asset),
    previous: input.previous,
  });
  const refs: Record<string, AssetRef> = {};
  const attachments: Attachment[] = [];
  for (const [key, { part, id, asset }] of parts) {
    if (
      part.mimeType.startsWith('image/') &&
      readable.discardedContentIds.has(asset.contentId) &&
      !explicitAttachment(part)
    ) {
      continue;
    }
    const bytes = await readPart({ ...input, messageId: input.message.id, part });
    refs[key] = await input.context.assets.capture({
      id,
      version: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      name: asset.name.slice(0, MAX_ASSET_NAME_LENGTH),
      mediaType: part.mimeType,
      read: () => Promise.resolve(new Blob([bytes]).stream()),
    });
    attachments.push(asset);
  }
  return { refs, attachments, body: readable.body, original: readable.original };
}
