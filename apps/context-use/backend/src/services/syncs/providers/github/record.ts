import { z } from 'zod';
import type { RecordInput } from '#backend/models/records/model.ts';

const pullSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  url: z.url(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  repository: z.object({ nameWithOwner: z.string() }),
  author: z.object({ id: z.string(), login: z.string() }).nullable(),
});

export function githubRecord(value: unknown) {
  const pull = pullSchema.parse(value);
  const title = `${pull.repository.nameWithOwner} #${pull.number}: ${pull.title}`;
  return {
    source: { provider: 'github', kind: 'pull-request', id: pull.id, url: pull.url },
    title,
    body: [
      `# ${title}`,
      pull.url,
      `State: ${pull.state}${pull.isDraft ? ' (draft)' : ''}`,
      `Author: ${pull.author?.login ?? 'Deleted user'}`,
      `Created: ${pull.createdAt} | Updated: ${pull.updatedAt}`,
      '## Description',
      pull.body
        .split(/\r\n|\r|\n/)
        .map((line) => `> ${line}`)
        .join('\n'),
    ].join('\n\n'),
    occurredAt: pull.createdAt,
    sourceCreatedAt: pull.createdAt,
    sourceUpdatedAt: pull.updatedAt,
  } satisfies RecordInput;
}
