import type { AssetRef } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import { markdownText, readableBody } from './content.ts';
import { messageContent } from './mime.ts';
import { header, type threadSchema } from './models.ts';

export async function threadRecord(input: {
  context: SyncContext;
  account: string;
  thread: z.infer<typeof threadSchema>;
}): Promise<SyncRecord> {
  const messages = [...input.thread.messages].sort(
    // biome-ignore lint/complexity/useMaxParams: Array.sort supplies both messages.
    (a, b) => Number(a.internalDate) - Number(b.internalDate) || a.id.localeCompare(b.id),
  );
  if (!messages.length || new Set(messages.map((message) => message.id)).size !== messages.length) {
    throw new Error('Gmail returned an incomplete conversation.');
  }
  const subject =
    header({ part: messages[0]!.payload, name: 'subject' }).trim() || 'Untitled email conversation';
  const assetRefs: Record<string, AssetRef> = {};
  const sections: string[] = [];
  const previous: string[] = [];
  let previousSubject = subject;
  for (const [index, message] of messages.entries()) {
    const content = await messageContent({ ...input, message });
    const readable = readableBody({ ...content, previous });
    previous.push(readable.original);
    Object.assign(assetRefs, content.refs);
    const currentSubject = header({ part: message.payload, name: 'subject' }).trim();
    const section = [
      `## Message ${index + 1} — ${markdownText(header({ part: message.payload, name: 'from' }) || 'Unknown sender')}`,
      `Sent: ${new Date(Number(message.internalDate)).toISOString()}`,
      `To: ${markdownText(header({ part: message.payload, name: 'to' }))}`,
      ...(header({ part: message.payload, name: 'cc' })
        ? [`Cc: ${markdownText(header({ part: message.payload, name: 'cc' }))}`]
        : []),
      ...(currentSubject && currentSubject !== previousSubject
        ? [`Subject: ${markdownText(currentSubject)}`]
        : []),
      readable.body || '*No new message text.*',
      ...(content.attachments.length
        ? [
            '### Attachments',
            ...content.attachments.map((asset) => `- [${markdownText(asset.name)}](${asset.file})`),
          ]
        : []),
    ];
    previousSubject = currentSubject || previousSubject;
    sections.push(section.join('\n\n'));
  }
  const first = new Date(Number(messages[0]!.internalDate)).toISOString();
  const last = new Date(Number(messages.at(-1)!.internalDate)).toISOString();
  const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(input.account)}#all/${encodeURIComponent(input.thread.id)}`;
  return {
    operation: 'upsert',
    kind: 'thread',
    id: JSON.stringify([input.account, input.thread.id]),
    preview: subject,
    createdAt: first,
    updatedAt: last,
    data: {
      account: input.account,
      threadId: input.thread.id,
      sourceOccurredAt: first,
      url,
    },
    content: {
      format: 'markdown',
      body: [`[Open conversation in Gmail](${url})`, ...sections].join('\n\n---\n\n'),
    },
    ...(Object.keys(assetRefs).length ? { assetRefs } : {}),
  };
}
