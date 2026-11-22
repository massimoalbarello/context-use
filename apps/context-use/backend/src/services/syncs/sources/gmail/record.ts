import type { AssetRef } from '@context-use/open-sync/assets';
import type { SyncContext } from '@context-use/open-sync/definition';
import type { SyncRecord } from '@context-use/open-sync/record';
import type { z } from 'zod';
import { markdownText } from './content.ts';
import { messageContent } from './mime.ts';
import { header, type MessagePart, type threadSchema } from './models.ts';

const sentTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function addressHeader(input: { part: MessagePart; name: 'from' | 'to' }) {
  const addresses = input.part.headers
    .filter((field) => field.name.toLowerCase() === input.name)
    .map((field) => field.value.replace(/\s*[\r\n]+\s*/g, ' ').trim())
    .filter(Boolean);
  return addresses.length ? markdownText(addresses.join(', ')) : 'Not listed';
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
  const subjectText = (value: string) => value.replace(/^(?:(?:re|r|fw|fwd|i):\s*)+/i, '').trim();
  let previousSubject = subjectText(subject);
  for (const message of messages) {
    const content = await messageContent({ ...input, message, previous });
    previous.push(content.original);
    Object.assign(assetRefs, content.refs);
    const currentSubject = header({ part: message.payload, name: 'subject' }).trim();
    const from = addressHeader({ part: message.payload, name: 'from' });
    const to = addressHeader({ part: message.payload, name: 'to' });
    const files = content.attachments.map(
      (asset) => `[${markdownText(asset.name)}](${asset.file})`,
    );
    const metadata = [
      `**To** · ${to}`,
      `**At** · ${sentTime.format(Number(message.internalDate))} UTC`,
      files.length && `**Attachments** · ${files.join(' · ')}`,
      currentSubject &&
        subjectText(currentSubject) !== previousSubject &&
        `**Subject** · ${markdownText(currentSubject)}`,
    ]
      .filter(Boolean)
      .join('  \n> ');
    previousSubject = currentSubject ? subjectText(currentSubject) : previousSubject;
    const heading = `> ### From · ${from}\n>\n> ${metadata}`;
    sections.push([heading, content.body].filter(Boolean).join('\n\n'));
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
      body: `${sections.join('\n\n---\n\n---\n\n')}\n\n---\n\n[Open conversation in Gmail](${url})`,
    },
    ...(Object.keys(assetRefs).length ? { assetRefs } : {}),
  };
}
