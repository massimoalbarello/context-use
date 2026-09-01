import type { KnowledgePage } from '../../queries/pages';
import { Badge } from '../ui/badge';

export function KnowledgePageRevisions({
  page,
}: {
  page: Pick<KnowledgePage, 'revisionNumber' | 'revisions'>;
}) {
  return (
    <section className="py-7">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-semibold text-lg">Revisions</h2>
        <Badge variant="secondary">{page.revisions.length}</Badge>
      </div>
      <ol className="grid max-w-3xl list-none gap-2 p-0">
        {page.revisions.map((revision) => (
          <li className="rounded-xl bg-muted px-4 py-3" key={revision.revisionNumber}>
            <div className="flex items-center gap-2">
              <strong className="font-semibold text-sm">Revision {revision.revisionNumber}</strong>
              {revision.revisionNumber === page.revisionNumber && (
                <Badge variant="secondary">Current</Badge>
              )}
            </div>
            <p className="mt-1 text-sm">{revision.title}</p>
            <p className="mt-1 text-muted-foreground text-xs">Created by {revision.author.name}</p>
            <time
              className="mt-1 block text-muted-foreground text-xs"
              dateTime={revision.createdAt.toISOString()}
            >
              {revision.createdAt.toLocaleString()}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
