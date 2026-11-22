import type { AssetRef } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import { markdownText } from './content.ts';
import { messageContent } from './mime.ts';
import { header, type threadSchema } from './models.ts';

const sentTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function senderName(from: string) {
  const mailbox = /^(.*?)\s*<([^<>]+)>$/.exec(from.trim());
  return (
    mailbox?.[1]?.trim().replace(/^"(.*)"$/, '$1') ||
    mailbox?.[2] ||
    from.trim() ||
    'Unknown sender'
  );
}

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
  for (const message of messages) {
    const content = await messageContent({ ...input, message, previous });
    previous.push(content.original);
    Object.assign(assetRefs, content.refs);
    const currentSubject = header({ part: message.payload, name: 'subject' }).trim();
    const sender = senderName(header({ part: message.payload, name: 'from' }));
    const attachmentLinks = content.attachments.map(
      (asset) => `- [${markdownText(asset.name)}](${asset.file})`,
    );
    const section = [
      `**${markdownText(sender)}** · ${sentTime.format(Number(message.internalDate))} UTC`,
      currentSubject &&
        currentSubject !== previousSubject &&
        `Subject: ${markdownText(currentSubject)}`,
      content.body || (!attachmentLinks.length && '*No new message text.*'),
      attachmentLinks.join('\n'),
    ];
    previousSubject = currentSubject || previousSubject;
    sections.push(section.filter(Boolean).join('\n\n'));
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
      body: [...sections, `[Open conversation in Gmail](${url})`].join('\n\n---\n\n'),
    },
    ...(Object.keys(assetRefs).length ? { assetRefs } : {}),
  };
}
